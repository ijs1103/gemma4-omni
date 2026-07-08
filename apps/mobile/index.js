/**
 * @format
 */

import 'react-native-gesture-handler'; // ← Must be first import for Drawer navigator
import 'react-native-reanimated';       // ← Must be early for Reanimated v4 worklets runtime
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);

