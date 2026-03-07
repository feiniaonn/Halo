package com.halo.spider;

/**
 * BridgeRunnerCompat - Entry point invoked by Rust/Tauri.
 * Delegates directly to BridgeRunner.main().
 * 
 * This class exists as a stable entry point name that the Rust side
 * can reference, while BridgeRunner handles the actual spider execution.
 */
public final class BridgeRunnerCompat {
    public static void main(String[] args) {
        BridgeRunner.main(args);
    }
}
