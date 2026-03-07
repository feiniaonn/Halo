/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  com.googlecode.dex2jar.tools.Dex2jarCmd
 *  org.objectweb.asm.ClassReader
 *  org.objectweb.asm.ClassVisitor
 *  org.objectweb.asm.ClassWriter
 *  org.objectweb.asm.Type
 *  org.objectweb.asm.tree.AbstractInsnNode
 *  org.objectweb.asm.tree.ClassNode
 *  org.objectweb.asm.tree.InsnList
 *  org.objectweb.asm.tree.InsnNode
 *  org.objectweb.asm.tree.MethodInsnNode
 *  org.objectweb.asm.tree.MethodNode
 *  org.objectweb.asm.tree.VarInsnNode
 */
package com.halo.spider;

import com.googlecode.dex2jar.tools.Dex2jarCmd;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.OpenOption;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.attribute.FileAttribute;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import java.util.jar.JarOutputStream;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Type;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.InsnNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.VarInsnNode;

public final class DexSpiderTransformer {
    private DexSpiderTransformer() {
    }

    /*
     * WARNING - Removed try catching itself - possible behaviour change.
     */
    public static void main(String[] stringArray) throws Exception {
        if (stringArray.length < 2) {
            throw new IllegalArgumentException("Usage: DexSpiderTransformer <input-jar> <output-jar>");
        }
        Path inputPath = Paths.get(stringArray[0]);
        Path outputPath = Paths.get(stringArray[1]);
        
        // Use a more unique intermediate name to avoid collisions
        Path rawJarPath = outputPath.resolveSibling(outputPath.getFileName().toString() + ".converting.jar");
        
        System.err.println("DEBUG: Starting Dex transform: " + inputPath + " -> " + outputPath);
        
        Files.createDirectories(outputPath.toAbsolutePath().getParent());
        Files.deleteIfExists(outputPath);
        Files.deleteIfExists(rawJarPath);

        try {
            // Use new instance to avoid static state issues and catch exceptions properly
            Dex2jarCmd cmd = new Dex2jarCmd();
            try {
                cmd.doMain("-f", "-o", rawJarPath.toString(), inputPath.toString());
            } catch (Throwable e) {
                System.err.println("ERROR: Dex2jarCmd internal failure: " + e.getMessage());
                e.printStackTrace(System.err);
                throw new IOException("Dex2jar conversion failed", e);
            }

            if (!Files.exists(rawJarPath)) {
                throw new IOException("Dex2jar finished but output file missing: " + rawJarPath);
            }

            DexSpiderTransformer.sanitizeConvertedJar(rawJarPath, outputPath);
            System.err.println("DEBUG: Dex spider transform success: " + inputPath + " -> " + outputPath);
        } finally {
            try {
                Files.deleteIfExists(rawJarPath);
            } catch (Exception e) {
                System.err.println("DEBUG: Failed to cleanup intermediate jar: " + e.getMessage());
            }
        }
    }

    private static void sanitizeConvertedJar(Path path, Path path2) throws IOException {
        try (JarFile jarFile = new JarFile(path.toFile());
             JarOutputStream jarOutputStream = new JarOutputStream(Files.newOutputStream(path2, new OpenOption[0]));){
            Enumeration<JarEntry> enumeration = jarFile.entries();
            while (enumeration.hasMoreElements()) {
                JarEntry jarEntry = enumeration.nextElement();
                JarEntry jarEntry2 = new JarEntry(jarEntry.getName());
                jarOutputStream.putNextEntry(jarEntry2);
                try (InputStream inputStream = jarFile.getInputStream(jarEntry);){
                    if (jarEntry.getName().endsWith(".class")) {
                        jarOutputStream.write(DexSpiderTransformer.sanitizeClass(inputStream.readAllBytes()));
                    } else {
                        DexSpiderTransformer.copy(inputStream, jarOutputStream);
                    }
                }
                jarOutputStream.closeEntry();
            }
        }
    }

    private static byte[] sanitizeClass(byte[] byArray) {
        ClassNode classNode = new ClassNode();
        new ClassReader(byArray).accept((ClassVisitor)classNode, 0);
        for (MethodNode methodNode : classNode.methods) {
            if ("<init>".equals(methodNode.name)) {
                DexSpiderTransformer.rewriteConstructor(classNode, methodNode);
                continue;
            }
            if (!"<clinit>".equals(methodNode.name)) continue;
            DexSpiderTransformer.rewriteClassInitializer(methodNode);
        }
        SafeClassWriter object = new SafeClassWriter(3);
        classNode.accept(object);
        return object.toByteArray();
    }

    private static void rewriteConstructor(ClassNode classNode, MethodNode methodNode) {
        methodNode.access &= 0xFFFFFA87;
        methodNode.instructions = new InsnList();
        methodNode.tryCatchBlocks = new ArrayList();
        methodNode.localVariables = new ArrayList();
        methodNode.instructions.add((AbstractInsnNode)new VarInsnNode(25, 0));
        methodNode.instructions.add((AbstractInsnNode)new MethodInsnNode(183, classNode.superName, "<init>", "()V", false));
        methodNode.instructions.add((AbstractInsnNode)new InsnNode(177));
        methodNode.maxLocals = Math.max(1, Type.getArgumentTypes((String)methodNode.desc).length + 1);
        methodNode.maxStack = 1;
    }

    private static void rewriteClassInitializer(MethodNode methodNode) {
        methodNode.access &= 0xFFFFFA88;
        methodNode.access |= 8;
        methodNode.instructions = new InsnList();
        methodNode.tryCatchBlocks = new ArrayList();
        methodNode.localVariables = new ArrayList();
        methodNode.instructions.add((AbstractInsnNode)new InsnNode(177));
        methodNode.maxLocals = 0;
        methodNode.maxStack = 0;
    }

    private static void copy(InputStream inputStream, OutputStream outputStream) throws IOException {
        int n;
        byte[] byArray = new byte[8192];
        while ((n = inputStream.read(byArray)) >= 0) {
            outputStream.write(byArray, 0, n);
        }
    }

    private static final class SafeClassWriter
    extends ClassWriter {
        SafeClassWriter(int n) {
            super(n);
        }

        protected String getCommonSuperClass(String string, String string2) {
            return "java/lang/Object";
        }
    }
}

