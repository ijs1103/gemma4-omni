import React, { useState, useEffect } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

interface RenameChatModalProps {
  visible: boolean;
  currentTitle: string;
  onClose: () => void;
  onRename: (newTitle: string) => void;
}

export const RenameChatModal: React.FC<RenameChatModalProps> = ({
  visible,
  currentTitle,
  onClose,
  onRename,
}) => {
  const [inputText, setInputText] = useState(currentTitle);

  // Sync state when modal becomes visible
  useEffect(() => {
    if (visible) {
      setInputText(currentTitle);
    }
  }, [visible, currentTitle]);

  const handleSave = () => {
    if (inputText.trim() === '') {
      return;
    }
    onRename(inputText.trim());
  };

  return (
    <Modal
      transparent={true}
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardAvoidingView}
        >
          <View style={styles.container}>
            {/* Title */}
            <Text style={styles.title}>채팅방 이름 변경</Text>

            {/* Input */}
            <TextInput
              style={styles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder="새로운 대화방 이름을 입력하세요"
              placeholderTextColor="#999"
              autoFocus={true}
              maxLength={30}
              selectTextOnFocus={true}
            />

            {/* Button Row */}
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.button, styles.cancelButton]}
                onPress={onClose}
                activeOpacity={0.7}
              >
                <Text style={styles.cancelButtonText}>취소</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.saveButton]}
                onPress={handleSave}
                activeOpacity={0.7}
                disabled={inputText.trim() === ''}
              >
                <Text style={[
                  styles.saveButtonText,
                  inputText.trim() === '' && styles.disabledText
                ]}>이름 변경</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyboardAvoidingView: {
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: '85%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 5,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#202124',
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: '#DADCE0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#202124',
    marginBottom: 24,
    backgroundColor: '#F8F9FA',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#F1F3F4',
  },
  cancelButtonText: {
    fontSize: 15,
    color: '#5F6368',
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: '#1a73e8',
  },
  saveButtonText: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  disabledText: {
    color: '#A0A0A0',
  },
});
