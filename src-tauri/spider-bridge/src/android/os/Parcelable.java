package android.os;

/**
 * Minimal Parcelable stub for desktop.
 */
public interface Parcelable {
    int CONTENTS_FILE_DESCRIPTOR = 1;
    void writeToParcel(Object dest, int flags);
    int describeContents();
}
