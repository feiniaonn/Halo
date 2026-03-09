import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Comparator;

public final class JarIntrospect {
    private JarIntrospect() {}

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("usage: JarIntrospect <jar1;jar2;...> <class1> [class2 ...]");
            System.exit(2);
        }

        String[] jarPaths = args[0].split(";");
        URL[] urls = Arrays.stream(jarPaths)
            .map(String::trim)
            .filter(s -> !s.isEmpty())
            .map(path -> Path.of(path).toUri())
            .map(uri -> {
                try {
                    return uri.toURL();
                } catch (Exception error) {
                    throw new RuntimeException(error);
                }
            })
            .toArray(URL[]::new);

        try (URLClassLoader loader = new URLClassLoader(urls, ClassLoader.getSystemClassLoader().getParent())) {
            for (int i = 1; i < args.length; i++) {
                inspect(loader, args[i]);
            }
        }
    }

    private static void inspect(ClassLoader loader, String className) {
        System.out.println("=== " + className + " ===");
        try {
            Class<?> clazz = Class.forName(className, false, loader);
            System.out.println("loadedFrom=" + clazz.getProtectionDomain().getCodeSource().getLocation());
            System.out.println("superClass=" + (clazz.getSuperclass() == null ? "<none>" : clazz.getSuperclass().getName()));
            System.out.println("interfaces=" + Arrays.toString(Arrays.stream(clazz.getInterfaces()).map(Class::getName).toArray()));

            Field[] fields = clazz.getDeclaredFields();
            Arrays.sort(fields, Comparator.comparing(Field::getName));
            for (Field field : fields) {
                System.out.println("field=" + field.getType().getTypeName() + " " + field.getName());
            }

            Constructor<?>[] constructors = clazz.getDeclaredConstructors();
            Arrays.sort(constructors, Comparator.comparing(Constructor::toString));
            for (Constructor<?> constructor : constructors) {
                System.out.println("ctor=" + constructor);
            }

            Method[] methods = clazz.getDeclaredMethods();
            Arrays.sort(methods, Comparator.comparing(Method::toString));
            for (Method method : methods) {
                System.out.println("method=" + method);
            }
        } catch (Throwable error) {
            System.out.println("error=" + error);
            Throwable cause = error.getCause();
            while (cause != null) {
                System.out.println("cause=" + cause);
                cause = cause.getCause();
            }
        }
        System.out.println();
    }
}
