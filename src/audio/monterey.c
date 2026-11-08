// Capture only the explicitly selected BlackHole loopback, never a microphone.
#include <AudioToolbox/AudioToolbox.h>
#include <CoreAudio/CoreAudio.h>
#include <stdlib.h>
#include <string.h>
typedef void (*Sink)(void *, const unsigned char *, unsigned int);
typedef struct { AudioQueueRef queue; Sink sink; void *ctx; } Capture;
static void receive(void *ctx, AudioQueueRef q, AudioQueueBufferRef b,
                    const AudioTimeStamp *time, UInt32 packets,
                    const AudioStreamPacketDescription *desc) {
    Capture *c = ctx;
    c->sink(c->ctx, b->mAudioData, b->mAudioDataByteSize);
    AudioQueueEnqueueBuffer(q, b, 0, NULL);
}
void *macrdp_audio_open(Sink sink, void *ctx, int *error) {
    Capture *c = calloc(1, sizeof(*c));
    if (!c) { *error = -1; return NULL; }
    c->sink = sink; c->ctx = ctx;
    AudioStreamBasicDescription fmt = {0};
    fmt.mSampleRate=44100; fmt.mFormatID=kAudioFormatLinearPCM;
    fmt.mFormatFlags=kLinearPCMFormatFlagIsSignedInteger|kLinearPCMFormatFlagIsPacked;
    fmt.mBytesPerPacket=4; fmt.mFramesPerPacket=1; fmt.mBytesPerFrame=4;
    fmt.mChannelsPerFrame=2; fmt.mBitsPerChannel=16;
    OSStatus s=AudioQueueNewInput(&fmt, receive, c, NULL, NULL, 0, &c->queue);
    CFStringRef uid=CFSTR("BlackHole2ch_UID");
    if (!s) s=AudioQueueSetProperty(c->queue,kAudioQueueProperty_CurrentDevice,&uid,sizeof(uid));
    for (int i=0; !s && i<3; i++) {
        AudioQueueBufferRef b;
        s=AudioQueueAllocateBuffer(c->queue,4096,&b);
        if (!s) s=AudioQueueEnqueueBuffer(c->queue,b,0,NULL);
    }
    if (!s) s=AudioQueueStart(c->queue,NULL);
    if (s) { if(c->queue) AudioQueueDispose(c->queue,true); free(c); *error=s; return NULL; }
    return c;
}
void macrdp_audio_close(void *ptr) {
    Capture *c=ptr;
    AudioQueueStop(c->queue,true);
    AudioQueueDispose(c->queue,true);
    free(c);
}
