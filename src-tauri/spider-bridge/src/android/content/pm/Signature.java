package android.content.pm;

public class Signature {
    private final String mSignature;

    public Signature(String signature) {
        mSignature = signature;
    }

    public String toCharsString() {
        return mSignature;
    }

    public byte[] toByteArray() {
        return mSignature.getBytes();
    }
}
