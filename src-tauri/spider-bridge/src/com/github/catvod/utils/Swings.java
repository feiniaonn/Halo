package com.github.catvod.utils;

import java.awt.Dimension;
import java.awt.GraphicsEnvironment;
import java.awt.Point;
import java.awt.Rectangle;
import java.awt.Toolkit;

/**
 * Swing helper utilities for the desktop CatVod spider UI.
 */
public class Swings {

    public static int dp2px(int dp) {
        return dp;
    }

    public static Point getCenter(int width, int height) {
        try {
            Dimension screenSize = Toolkit.getDefaultToolkit().getScreenSize();
            return new Point((screenSize.width - width) / 2, (screenSize.height - height) / 2);
        } catch (Exception e) {
            return new Point(100, 100);
        }
    }

    public static Point screenRightDown(int width, int height) {
        try {
            Rectangle rect = GraphicsEnvironment.getLocalGraphicsEnvironment()
                    .getMaximumWindowBounds();
            return new Point(rect.x + rect.width - width - 10, rect.y + rect.height - height - 10);
        } catch (Exception e) {
            return new Point(800, 600);
        }
    }
}
