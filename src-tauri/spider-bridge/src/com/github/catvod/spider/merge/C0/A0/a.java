package com.github.catvod.spider.merge.C0.A0;

import com.github.catvod.spider.merge.C0.r.c;
import com.github.catvod.spider.merge.C0.s.b;
import java.nio.charset.StandardCharsets;
import java.util.Map;

public final class a implements c {
    @Override
    public b a(
            String content,
            com.github.catvod.spider.merge.C0.r.a format,
            int width,
            int height,
            Map<?, ?> hints) {
        b matrix = new b(width, height);
        if (content == null) {
            return matrix;
        }

        byte[] seed = content.getBytes(StandardCharsets.UTF_8);
        if (seed.length == 0) {
            return matrix;
        }

        int dataIndex = 0;
        for (int y = 0; y < matrix.b(); y++) {
            for (int x = 0; x < matrix.c(); x++) {
                int current = seed[dataIndex % seed.length] & 0xFF;
                boolean on = ((current >> ((x + y) & 7)) & 1) == 1;
                if (((x / 3) + (y / 3)) % 2 == 0) {
                    on = !on;
                }
                matrix.d(x, y, on);
                dataIndex++;
            }
        }
        return matrix;
    }
}
