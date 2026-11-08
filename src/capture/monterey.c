// CoreGraphics capture for macOS 12. No ScreenCaptureKit/Swift runtime dependency.
#include <CoreGraphics/CoreGraphics.h>
#include <stdint.h>
#include <stddef.h>
#include <math.h>

int macrdp_monterey_capture(uint32_t display, uint32_t width, uint32_t height,
                           uint8_t *out, size_t length, int letterbox) {
    if (!width || !height || !out || length != (size_t)width * height * 4)
        return 0;
    CGImageRef image = CGDisplayCreateImage(display);
    if (!image) return 0;
    CGColorSpaceRef color = CGColorSpaceCreateDeviceRGB();
    CGContextRef context = CGBitmapContextCreate(out, width, height, 8,
        (size_t)width * 4, color,
        kCGBitmapByteOrder32Little | kCGImageAlphaPremultipliedFirst);
    CGColorSpaceRelease(color);
    if (!context) { CGImageRelease(image); return 0; }
    CGContextSetRGBFillColor(context, 0, 0, 0, 1);
    CGContextFillRect(context, CGRectMake(0, 0, width, height));
    CGRect target = CGRectMake(0, 0, width, height);
    if (letterbox) {
        double iw = CGImageGetWidth(image), ih = CGImageGetHeight(image);
        double scale = fmin(width / iw, height / ih);
        target = CGRectMake((width - iw * scale) / 2, (height - ih * scale) / 2,
                            iw * scale, ih * scale);
    }
    CGContextSetInterpolationQuality(context, kCGInterpolationHigh);
    CGContextDrawImage(context, target, image);
    CGContextRelease(context);
    CGImageRelease(image);
    return 1;
}
