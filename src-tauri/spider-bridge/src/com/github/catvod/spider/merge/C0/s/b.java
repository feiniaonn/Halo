package com.github.catvod.spider.merge.C0.s;

public class b {
    private final int width;
    private final int height;
    private final boolean[][] matrix;

    public b(int width, int height) {
        this.width = Math.max(width, 1);
        this.height = Math.max(height, 1);
        this.matrix = new boolean[this.height][this.width];
    }

    public boolean a(int x, int y) {
        if (x < 0 || y < 0 || x >= width || y >= height) {
            return false;
        }
        return matrix[y][x];
    }

    public int b() {
        return height;
    }

    public int c() {
        return width;
    }

    public void d(int x, int y, boolean value) {
        if (x < 0 || y < 0 || x >= width || y >= height) {
            return;
        }
        matrix[y][x] = value;
    }
}
