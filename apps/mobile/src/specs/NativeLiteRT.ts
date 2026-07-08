import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  loadModel(modelPath: string): Promise<boolean>;
  generateStream(prompt: string): Promise<void>;
  generateStreamWithMedia(prompt: string, imagePaths: string[]): Promise<void>;
  interruptGeneration(): Promise<boolean>;
  unloadModel(): Promise<void>;

  // Required for NativeEventEmitter
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('LiteRT');
