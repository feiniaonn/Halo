use flate2::read::ZlibDecoder;
use std::io::Read;

const DES_BLOCK_SIZE: usize = 8;
const ROUNDS: usize = 16;
const SUB_KEY_SIZE: usize = 6;
type TripleDesKeySchedules = [[[u8; SUB_KEY_SIZE]; ROUNDS]; 3];

const DECRYPT_SCHEDULES: TripleDesKeySchedules = [
    custom_des::key_schedule(custom_des::KEY_3, custom_des::Mode::Decrypt),
    custom_des::key_schedule(custom_des::KEY_2, custom_des::Mode::Encrypt),
    custom_des::key_schedule(custom_des::KEY_1, custom_des::Mode::Decrypt),
];

#[rustfmt::skip]
const PRIVKEY: [u8; 128] = [
    0xc3, 0x4a, 0xd6, 0xca, 0x90, 0x67, 0xf7, 0x52, 0xd8, 0xa1, 0x66, 0x62, 0x9f, 0x5b, 0x09, 0x00,
    0xc3, 0x5e, 0x95, 0x23, 0x9f, 0x13, 0x11, 0x7e, 0xd8, 0x92, 0x3f, 0xbc, 0x90, 0xbb, 0x74, 0x0e,
    0xc3, 0x47, 0x74, 0x3d, 0x90, 0xaa, 0x3f, 0x51, 0xd8, 0xf4, 0x11, 0x84, 0x9f, 0xde, 0x95, 0x1d,
    0xc3, 0xc6, 0x09, 0xd5, 0x9f, 0xfa, 0x66, 0xf9, 0xd8, 0xf0, 0xf7, 0xa0, 0x90, 0xa1, 0xd6, 0xf3,
    0xc3, 0xf3, 0xd6, 0xa1, 0x90, 0xa0, 0xf7, 0xf0, 0xd8, 0xf9, 0x66, 0xfa, 0x9f, 0xd5, 0x09, 0xc6,
    0xc3, 0x1d, 0x95, 0xde, 0x9f, 0x84, 0x11, 0xf4, 0xd8, 0x51, 0x3f, 0xaa, 0x90, 0x3d, 0x74, 0x47,
    0xc3, 0x0e, 0x74, 0xbb, 0x90, 0xbc, 0x3f, 0x92, 0xd8, 0x7e, 0x11, 0x13, 0x9f, 0x23, 0x95, 0x5e,
    0xc3, 0x00, 0x09, 0x5b, 0x9f, 0x62, 0x66, 0xa1, 0xd8, 0x52, 0xf7, 0x67, 0x90, 0xca, 0xd6, 0x4a,
];

pub fn decrypt_local_qrc(encrypted_bytes: &[u8]) -> Result<String, String> {
    let mut data = encrypted_bytes.to_vec();
    qmc1_decrypt(&mut data);
    if data.len() < 11 {
        return Err("qqmusic qrc payload is too short".to_string());
    }
    decrypt_lyrics_from_bytes(&data[11..])
}

fn qmc1_decrypt(data: &mut [u8]) {
    const THRESHOLD: usize = 0x7FFF + 1;

    if data.len() < THRESHOLD {
        for (index, byte) in data.iter_mut().enumerate() {
            *byte ^= PRIVKEY[index & 0x7F];
        }
        return;
    }

    let (first_chunk, second_chunk) = data.split_at_mut(THRESHOLD);
    for (index, byte) in first_chunk.iter_mut().enumerate() {
        *byte ^= PRIVKEY[index & 0x7F];
    }
    for (index, byte) in second_chunk.iter_mut().enumerate() {
        let original_index = THRESHOLD + index;
        *byte ^= PRIVKEY[(original_index % 0x7FFF) & 0x7F];
    }
}

fn decrypt_lyrics_from_bytes(encrypted_bytes: &[u8]) -> Result<String, String> {
    if !encrypted_bytes.len().is_multiple_of(DES_BLOCK_SIZE) {
        return Err("qqmusic qrc encrypted payload is misaligned".to_string());
    }

    let mut decrypted = vec![0u8; encrypted_bytes.len()];
    for (out, chunk) in decrypted
        .chunks_mut(DES_BLOCK_SIZE)
        .zip(encrypted_bytes.chunks(DES_BLOCK_SIZE))
    {
        decrypt_block(chunk, out);
    }

    let mut decoder = ZlibDecoder::new(decrypted.as_slice());
    let mut out = Vec::new();
    decoder
        .read_to_end(&mut out)
        .map_err(|error| format!("qqmusic qrc zlib decode failed: {error}"))?;
    if out.starts_with(&[0xEF, 0xBB, 0xBF]) {
        out.drain(..3);
    }
    String::from_utf8(out).map_err(|error| format!("qqmusic qrc utf8 decode failed: {error}"))
}

fn decrypt_block(input: &[u8], output: &mut [u8]) {
    let mut temp1 = [0u8; 8];
    let mut temp2 = [0u8; 8];
    custom_des::des_crypt(input, &mut temp1, &DECRYPT_SCHEDULES[0]);
    custom_des::des_crypt(&temp1, &mut temp2, &DECRYPT_SCHEDULES[1]);
    custom_des::des_crypt(&temp2, output, &DECRYPT_SCHEDULES[2]);
}

mod custom_des {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub(super) enum Mode {
        Encrypt,
        Decrypt,
    }

    pub(super) const KEY_1: [u8; 8] = *b"!@#)(*$%";
    pub(super) const KEY_2: [u8; 8] = *b"123ZXC!@";
    pub(super) const KEY_3: [u8; 8] = *b"!@#)(NHL";

    #[rustfmt::skip]
    const SBOX1: [u8; 64] = [
        14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7, 0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,
        4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0, 15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13,
    ];
    #[rustfmt::skip]
    const SBOX2: [u8; 64] = [
        15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10, 3,13,4,7,15,2,8,15,12,0,1,10,6,9,11,5,
        0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15, 13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9,
    ];
    #[rustfmt::skip]
    const SBOX3: [u8; 64] = [
        10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8, 13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,
        13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7, 1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12,
    ];
    #[rustfmt::skip]
    const SBOX4: [u8; 64] = [
        7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15, 13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,
        10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4, 3,15,0,6,10,10,13,8,9,4,5,11,12,7,2,14,
    ];
    #[rustfmt::skip]
    const SBOX5: [u8; 64] = [
        2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9, 14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,
        4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14, 11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3,
    ];
    #[rustfmt::skip]
    const SBOX6: [u8; 64] = [
        12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11, 10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,
        9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6, 4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13,
    ];
    #[rustfmt::skip]
    const SBOX7: [u8; 64] = [
        4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1, 13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,
        1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2, 6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12,
    ];
    #[rustfmt::skip]
    const SBOX8: [u8; 64] = [
        13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7, 1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,
        7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8, 2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11,
    ];
    const S_BOXES: [[u8; 64]; 8] = [SBOX1, SBOX2, SBOX3, SBOX4, SBOX5, SBOX6, SBOX7, SBOX8];

    #[rustfmt::skip]
    const P_BOX: [u8; 32] = [16,7,20,21,29,12,28,17, 1,15,23,26,5,18,31,10, 2,8,24,14,32,27,3,9, 19,13,30,6,22,11,4,25];
    #[rustfmt::skip]
    const E_BOX_TABLE: [u8; 48] = [
        32,1,2,3,4,5, 4,5,6,7,8,9, 8,9,10,11,12,13, 12,13,14,15,16,17,
        16,17,18,19,20,21, 20,21,22,23,24,25, 24,25,26,27,28,29, 28,29,30,31,32,1,
    ];

    const fn generate_sp_tables() -> [[u32; 64]; 8] {
        let mut sp_tables = [[0u32; 64]; 8];
        let mut s_box_idx = 0;
        while s_box_idx < 8 {
            let mut s_box_input = 0;
            while s_box_input < 64 {
                let s_box_index = calculate_sbox_index(s_box_input as u8);
                let four_bit_output = S_BOXES[s_box_idx][s_box_index];
                let pre_p_box_val = (four_bit_output as u32) << (28 - (s_box_idx * 4));
                sp_tables[s_box_idx][s_box_input] = apply_pbox_permutation(pre_p_box_val, &P_BOX);
                s_box_input += 1;
            }
            s_box_idx += 1;
        }
        sp_tables
    }

    const SP_TABLES: [[u32; 64]; 8] = generate_sp_tables();

    const fn apply_pbox_permutation(input: u32, table: &[u8; 32]) -> u32 {
        let mut source_bits = [0u8; 32];
        let mut i = 0;
        while i < 32 {
            source_bits[i] = ((input >> (31 - i)) & 1) as u8;
            i += 1;
        }
        let mut dest_bits = [0u8; 32];
        let mut dest_idx = 0;
        while dest_idx < 32 {
            let source_pos = table[dest_idx] as usize - 1;
            dest_bits[dest_idx] = source_bits[source_pos];
            dest_idx += 1;
        }
        let mut output = 0u32;
        let mut i = 0;
        while i < 32 {
            output |= (dest_bits[i] as u32) << (31 - i);
            i += 1;
        }
        output
    }

    const fn calculate_sbox_index(a: u8) -> usize {
        ((a & 0x20) | ((a & 0x1f) >> 1) | ((a & 0x01) << 4)) as usize
    }

    const fn rotate_left_28bit_in_u32(value: u32, amount: u32) -> u32 {
        const BITS_28_MASK: u32 = 0xFFFF_FFF0;
        ((value << amount) | (value >> (28 - amount))) & BITS_28_MASK
    }

    const fn permute_from_key_bytes(key: [u8; 8], table: &[usize]) -> u64 {
        let word1 = u32::from_le_bytes([key[0], key[1], key[2], key[3]]);
        let word2 = u32::from_le_bytes([key[4], key[5], key[6], key[7]]);
        let key_u64 = ((word1 as u64) << 32) | (word2 as u64);
        let mut output = 0u64;
        let output_len = table.len();
        let mut i = 0;
        while i < output_len {
            let pos = table[i];
            let bit = (key_u64 >> (63 - pos)) & 1;
            if bit != 0 {
                output |= 1u64 << (output_len - 1 - i);
            }
            i += 1;
        }
        output
    }

    const fn apply_e_box_permutation(input: u32) -> u64 {
        let mut output = 0u64;
        let mut i = 0;
        while i < E_BOX_TABLE.len() {
            let source_bit_pos = E_BOX_TABLE[i];
            let shift_amount = 32 - source_bit_pos;
            let bit = (input >> shift_amount) & 1;
            output |= (bit as u64) << (47 - i);
            i += 1;
        }
        output
    }

    pub(super) const fn key_schedule(key: [u8; 8], mode: Mode) -> [[u8; 6]; 16] {
        #[rustfmt::skip]
        const KEY_RND_SHIFT: [u32; 16] = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];
        #[rustfmt::skip]
        const KEY_PERM_C: [usize; 28] = [56,48,40,32,24,16,8,0,57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35];
        #[rustfmt::skip]
        const KEY_PERM_D: [usize; 28] = [62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,60,52,44,36,28,20,12,4,27,19,11,3];
        #[rustfmt::skip]
        const KEY_COMPRESSION: [usize; 48] = [
            13,16,10,23,0,4,2,27,14,5,20,9,22,18,11,3,25,7,15,6,26,19,12,1,
            40,51,30,36,46,54,29,39,50,44,32,47,43,48,38,55,33,52,45,41,49,35,28,31,
        ];

        let mut schedule = [[0u8; 6]; 16];
        let c0 = permute_from_key_bytes(key, &KEY_PERM_C);
        let d0 = permute_from_key_bytes(key, &KEY_PERM_D);
        let mut c = (c0 as u32) << 4;
        let mut d = (d0 as u32) << 4;
        let mut i = 0;
        while i < 16 {
            let shift = KEY_RND_SHIFT[i];
            c = rotate_left_28bit_in_u32(c, shift);
            d = rotate_left_28bit_in_u32(d, shift);
            let to_gen = if matches!(mode, Mode::Decrypt) {
                15 - i
            } else {
                i
            };

            let mut subkey_48bit = 0u64;
            let mut k = 0;
            while k < 48 {
                let pos = KEY_COMPRESSION[k];
                let bit = if pos < 28 {
                    (c >> (31 - pos)) & 1
                } else {
                    (d >> (31 - (pos - 27))) & 1
                };
                if bit != 0 {
                    subkey_48bit |= 1u64 << (47 - k);
                }
                k += 1;
            }

            let subkey_bytes = subkey_48bit.to_be_bytes();
            let mut byte_idx = 0;
            while byte_idx < 6 {
                schedule[to_gen][byte_idx] = subkey_bytes[2 + byte_idx];
                byte_idx += 1;
            }
            i += 1;
        }
        schedule
    }

    struct DesPermutationTables {
        ip_table: [[(u32, u32); 256]; 8],
        inv_ip_table: [[u64; 256]; 8],
    }

    impl DesPermutationTables {
        const fn new() -> Self {
            #[rustfmt::skip]
            const IP_RULE: [u8; 64] = [
                34,42,50,58,2,10,18,26, 36,44,52,60,4,12,20,28, 38,46,54,62,6,14,22,30, 40,48,56,64,8,16,24,32,
                33,41,49,57,1,9,17,25, 35,43,51,59,3,11,19,27, 37,45,53,61,5,13,21,29, 39,47,55,63,7,15,23,31,
            ];
            #[rustfmt::skip]
            const INV_IP_RULE: [u8; 64] = [
                37,5,45,13,53,21,61,29, 38,6,46,14,54,22,62,30, 39,7,47,15,55,23,63,31, 40,8,48,16,56,24,64,32,
                33,1,41,9,49,17,57,25, 34,2,42,10,50,18,58,26, 35,3,43,11,51,19,59,27, 36,4,44,12,52,20,60,28,
            ];

            const fn apply_permutation(input: [u8; 8], rule: &[u8; 64]) -> u64 {
                let normalized_input = u64::from_be_bytes(input);
                let mut result = 0u64;
                let mut i = 0;
                while i < 64 {
                    let src_bit_pos = rule[i] as usize - 1;
                    let bit = (normalized_input >> (63 - src_bit_pos)) & 1;
                    result |= bit << (63 - i);
                    i += 1;
                }
                result
            }

            let mut ip_table = [[(0, 0); 256]; 8];
            let mut inv_ip_table = [[0; 256]; 8];
            let mut input = [0u8; 8];

            let mut byte_pos = 0;
            while byte_pos < 8 {
                let mut byte_val = 0;
                while byte_val < 256 {
                    let mut i = 0;
                    while i < input.len() {
                        input[i] = 0;
                        i += 1;
                    }
                    input[byte_pos] = byte_val as u8;
                    let permuted = apply_permutation(input, &IP_RULE);
                    ip_table[byte_pos][byte_val] = ((permuted >> 32) as u32, permuted as u32);
                    byte_val += 1;
                }
                byte_pos += 1;
            }

            let mut block_pos = 0;
            while block_pos < 8 {
                let mut block_val = 0;
                while block_val < 256 {
                    let temp_input_u64 = (block_val as u64) << (56 - (block_pos * 8));
                    let temp_input_bytes = temp_input_u64.to_be_bytes();
                    inv_ip_table[block_pos][block_val] =
                        apply_permutation(temp_input_bytes, &INV_IP_RULE);
                    block_val += 1;
                }
                block_pos += 1;
            }

            Self {
                ip_table,
                inv_ip_table,
            }
        }
    }

    #[rustfmt::skip]
    const fn f_function(state: u32, key: &[u8]) -> u32 {
        let expanded_state = apply_e_box_permutation(state);
        let key_u64 = u64::from_be_bytes([0, 0, key[0], key[1], key[2], key[3], key[4], key[5]]);
        let xor_result = expanded_state ^ key_u64;
        SP_TABLES[0][((xor_result >> 42) & 0x3F) as usize]
            | SP_TABLES[1][((xor_result >> 36) & 0x3F) as usize]
            | SP_TABLES[2][((xor_result >> 30) & 0x3F) as usize]
            | SP_TABLES[3][((xor_result >> 24) & 0x3F) as usize]
            | SP_TABLES[4][((xor_result >> 18) & 0x3F) as usize]
            | SP_TABLES[5][((xor_result >> 12) & 0x3F) as usize]
            | SP_TABLES[6][((xor_result >>  6) & 0x3F) as usize]
            | SP_TABLES[7][( xor_result        & 0x3F) as usize]
    }

    const TABLES: DesPermutationTables = DesPermutationTables::new();

    fn initial_permutation(state: &mut [u32; 2], input: &[u8]) {
        state.fill(0);
        for (table_slice, &input_byte) in TABLES.ip_table.iter().zip(input.iter()) {
            let lookup = table_slice[input_byte as usize];
            state[0] |= lookup.0;
            state[1] |= lookup.1;
        }
    }

    fn inverse_permutation(state: [u32; 2], output: &mut [u8]) {
        let state_u64 = (u64::from(state[0]) << 32) | u64::from(state[1]);
        let state_bytes = state_u64.to_be_bytes();
        let result = state_bytes
            .iter()
            .enumerate()
            .fold(0u64, |acc, (index, &byte)| {
                acc | TABLES.inv_ip_table[index][byte as usize]
            });
        output.copy_from_slice(&result.to_be_bytes());
    }

    pub(super) fn des_crypt(
        input: &[u8],
        output: &mut [u8],
        key: &[[u8; super::SUB_KEY_SIZE]; super::ROUNDS],
    ) {
        let mut state = [0u32; 2];
        initial_permutation(&mut state, input);
        for round_key in key.iter().take(15) {
            let prev_right = state[1];
            let prev_left = state[0];
            state[1] = prev_left ^ f_function(prev_right, round_key);
            state[0] = prev_right;
        }
        state[0] ^= f_function(state[1], &key[15]);
        inverse_permutation(state, output);
    }
}
