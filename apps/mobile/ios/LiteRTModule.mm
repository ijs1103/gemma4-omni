#import "LiteRTModule.h"
#import <React/RCTLog.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// React Native New Architecture 헤더 (mobile-Swift.h 임포트 전에 필요)
#if __has_include(<RCTAppDelegate.h>)
#import <RCTAppDelegate.h>
#endif
#if __has_include(<React/RCTDefaultReactNativeFactoryDelegate.h>)
#import <React/RCTDefaultReactNativeFactoryDelegate.h>
#endif
#if __has_include(<ReactAppDependencyProvider/RCTThirdPartyComponentsProvider.h>)
#import <ReactAppDependencyProvider/RCTThirdPartyComponentsProvider.h>
#endif

// Xcode가 자동 생성하는 Swift → ObjC 브릿지 헤더
// Swift 컴파일이 선행되어야 이 헤더가 생성됩니다.
#import "mobile-Swift.h"

@implementation LiteRTModule

RCT_EXPORT_MODULE(LiteRT)

+ (BOOL)requiresMainQueueSetup {
    return NO;
}

- (NSArray<NSString *> *)supportedEvents {
    return @[@"onTokenGenerated", @"onGenerationFinished", @"onGenerationError"];
}

#pragma mark - Load Model

RCT_EXPORT_METHOD(loadModel:(NSString *)modelPath
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    RCTLogInfo(@"[LiteRTModule] loadModel called with path: %@", modelPath);

    [[LiteRTSwiftEngine shared] loadModel:modelPath completion:^(NSError * _Nullable error) {
        if (error) {
            RCTLogError(@"[LiteRTModule] Failed to load model: %@", error.localizedDescription);
            reject(@"LOAD_ERROR", error.localizedDescription, error);
        } else {
            RCTLogInfo(@"[LiteRTModule] Model loaded successfully");
            resolve(@(YES));
        }
    }];
}

#pragma mark - Generate Stream

RCT_EXPORT_METHOD(generateStream:(NSString *)prompt
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    RCTLogInfo(@"[LiteRTModule] generateStream called");

    // Promise를 즉시 resolve하여 JS 스레드를 해제하고,
    // 토큰 생성은 이벤트 스트리밍으로 전달 (Android LiteRTModule.kt와 동일 패턴)
    resolve([NSNull null]);

    [[LiteRTSwiftEngine shared] generateStream:prompt
        onToken:^(NSString * _Nonnull text) {
            [self sendEventWithName:@"onTokenGenerated" body:@{@"text": text}];
        }
        onFinish:^{
            [self sendEventWithName:@"onGenerationFinished" body:@{}];
        }
        onError:^(NSString * _Nonnull errorMessage) {
            [self sendEventWithName:@"onGenerationError" body:@{@"error": errorMessage}];
        }
    ];
}

#pragma mark - Generate Stream With Media

RCT_EXPORT_METHOD(generateStreamWithMedia:(NSString *)prompt
                  imagePaths:(NSArray<NSString *> *)imagePaths
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    RCTLogInfo(@"[LiteRTModule] generateStreamWithMedia called");

    resolve([NSNull null]);

    [[LiteRTSwiftEngine shared] generateStreamWithMedia:prompt
        imagePaths:imagePaths
        onToken:^(NSString * _Nonnull text) {
            [self sendEventWithName:@"onTokenGenerated" body:@{@"text": text}];
        }
        onFinish:^{
            [self sendEventWithName:@"onGenerationFinished" body:@{}];
        }
        onError:^(NSString * _Nonnull errorMessage) {
            [self sendEventWithName:@"onGenerationError" body:@{@"error": errorMessage}];
        }
    ];
}

#pragma mark - Unload Model

RCT_EXPORT_METHOD(unloadModel:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    RCTLogInfo(@"[LiteRTModule] unloadModel called");
    [[LiteRTSwiftEngine shared] unloadModel];
    resolve([NSNull null]);
}

@end

#pragma mark - PDF Text Extraction Module

@protocol MyPDFDocument <NSObject>
- (instancetype)initWithURL:(NSURL *)url;
- (NSInteger)pageCount;
- (id)pageAtIndex:(NSInteger)index;
@end

@protocol MyPDFPage <NSObject>
- (NSString *)string;
@end

@interface PdfTextExtract : NSObject <RCTBridgeModule>
@end

@implementation PdfTextExtract

RCT_EXPORT_MODULE(PdfTextExtract);

+ (BOOL)requiresMainQueueSetup {
    return NO;
}

RCT_EXPORT_METHOD(extractText:(NSString *)filePath
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
        @autoreleasepool {
            @try {
                Class pdfDocClass = NSClassFromString(@"PDFDocument");
                if (!pdfDocClass) {
                    NSBundle *bundle = [NSBundle bundleWithPath:@"/System/Library/Frameworks/PDFKit.framework"];
                    [bundle load];
                    pdfDocClass = NSClassFromString(@"PDFDocument");
                }
                
                if (!pdfDocClass) {
                    reject(@"LOAD_FAILED", @"PDFKit framework is not available on this device", nil);
                    return;
                }
                
                NSURL *fileURL = [NSURL fileURLWithPath:filePath];
                id<MyPDFDocument> document = (id<MyPDFDocument>)[pdfDocClass alloc];
                
                if ([document respondsToSelector:@selector(initWithURL:)]) {
                    document = [document initWithURL:fileURL];
                } else {
                    document = nil;
                }
                
                if (!document) {
                    reject(@"LOAD_FAILED", [NSString stringWithFormat:@"Failed to load PDF document from path: %@", filePath], nil);
                    return;
                }
                
                NSMutableString *extractedText = [NSMutableString string];
                NSInteger pageCount = 0;
                
                if ([document respondsToSelector:@selector(pageCount)]) {
                    pageCount = [document pageCount];
                }
                
                for (NSInteger i = 0; i < pageCount; i++) {
                    @autoreleasepool {
                        if ([document respondsToSelector:@selector(pageAtIndex:)]) {
                            id<MyPDFPage> page = [document pageAtIndex:i];
                            if (page && [page respondsToSelector:@selector(string)]) {
                                NSString *pageText = [page string];
                                if (pageText) {
                                    [extractedText appendString:pageText];
                                    [extractedText appendString:@"\n"];
                                }
                            }
                        }
                    }
                }
                
                resolve(@{
                    @"text": extractedText,
                    @"pageCount": @(pageCount)
                });
            } @catch (NSException *exception) {
                reject(@"EXTRACT_ERROR", [NSString stringWithFormat:@"Exception: %@", exception.reason], nil);
            }
        }
    });
}

@end
