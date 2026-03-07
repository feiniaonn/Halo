package com.halo.spider.native_bridge;

import com.github.unidbg.AndroidEmulator;
import com.github.unidbg.linux.android.AndroidEmulatorBuilder;
import com.github.unidbg.linux.android.AndroidResolver;
import com.github.unidbg.linux.android.dvm.*;
import com.github.unidbg.memory.Memory;
import com.halo.spider.mock.MockContext;

import java.io.File;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

/**
 * Android Native (.so) Loader using Unidbg.
 * Allows Windows desktop to execute ARM/ARM64 native libraries.
 */
public class NativeLoader {
    private static NativeLoader instance;
    private final AndroidEmulator emulator;
    private final VM vm;
    private final Map<String, DalvikModule> loadedModules = new HashMap<>();

    private NativeLoader() {
        // Create 32-bit ARM emulator by default (most common for TVBox spiders)
        emulator = AndroidEmulatorBuilder.for32Bit().setProcessName("com.halo.spider").build();
        Memory memory = emulator.getMemory();
        memory.setLibraryResolver(new AndroidResolver(23)); // API 23

        // Initialize Dalvik VM
        vm = emulator.createDalvikVM((File) null); // No APK needed mostly
        vm.setVerbose(false);
    }

    public static synchronized NativeLoader getInstance() {
        if (instance == null) {
            instance = new NativeLoader();
        }
        return instance;
    }

    /**
     * Load an .so library file.
     */
    public synchronized DalvikModule loadLibrary(File soFile) {
        String path = soFile.getAbsolutePath();
        if (loadedModules.containsKey(path)) {
            return loadedModules.get(path);
        }

        // --- NEW: Search in spider.lib.dir if file doesn't exist at absolute path ---
        if (!soFile.exists()) {
            String libDir = System.getProperty("spider.lib.dir");
            if (libDir != null) {
                File searchFile = new File(libDir, soFile.getName());
                if (searchFile.exists()) {
                    soFile = searchFile;
                    path = soFile.getAbsolutePath();
                }
            }
        }

        DalvikModule module = vm.loadLibrary(soFile, false);
        module.callJNI_OnLoad(emulator);
        loadedModules.put(path, module);
        return module;
    }

    /**
     * Resolve a Java class within the Unidbg VM.
     */
    public DvmClass resolveClass(String className) {
        return vm.resolveClass(className.replace('.', '/'));
    }

    /**
     * Call a static native method.
     */
    public Object callStaticMethod(String className, String methodName, String signature, Object... args) {
        DvmClass dvmClass = resolveClass(className);
        return dvmClass.callStaticJniMethodObject(emulator, methodName + signature, args);
    }

    public void destroy() {
        try {
            emulator.close();
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}
