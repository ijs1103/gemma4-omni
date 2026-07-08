import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { preprocessMarkdown } from '../utils/markdown';

interface ChatBubbleProps {
  content: string;
  isUser: boolean;
  isThinking?: boolean;
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({ content, isUser, isThinking }) => {
  return (
    <View style={[styles.container, isUser ? styles.userContainer : styles.aiContainer]}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}>
        {isUser ? (
          <Text style={styles.userText}>{content}</Text>
        ) : isThinking ? (
          <View style={styles.thinkingContainer}>
            <View style={styles.dot} />
            <View style={[styles.dot, { opacity: 0.7 }]} />
            <View style={[styles.dot, { opacity: 0.4 }]} />
          </View>
        ) : (
          <Markdown style={markdownStyles}>
            {preprocessMarkdown(content || '...')}
          </Markdown>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginBottom: 16,
    width: '100%',
  },
  userContainer: {
    justifyContent: 'flex-end',
    paddingLeft: 40,
  },
  aiContainer: {
    justifyContent: 'flex-start',
    paddingRight: 40,
  },
  bubble: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    maxWidth: '100%',
  },
  userBubble: {
    backgroundColor: '#3f51b5',
    borderBottomRightRadius: 4,
  },
  aiBubble: {
    backgroundColor: '#1e1e38',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#2e2e5c',
  },
  userText: {
    color: '#ffffff',
    fontSize: 16,
    lineHeight: 22,
  },
  thinkingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 24,
    width: 40,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#a0a0d0',
    marginHorizontal: 2,
  },
});

const markdownStyles = StyleSheet.create({
  body: {
    color: '#e0e0ff',
    fontSize: 15,
    lineHeight: 24,
  },
  heading1: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 10,
  },
  heading2: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 14,
    marginBottom: 8,
  },
  heading3: {
    color: '#f0f0ff',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 6,
  },
  strong: {
    fontWeight: 'bold',
    color: '#90caf9',
  },
  em: {
    fontStyle: 'italic',
    color: '#b0b0d0',
  },
  code_inline: {
    backgroundColor: '#2a2a4a',
    color: '#ffab91',
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  code_block: {
    backgroundColor: '#0a0a14',
    color: '#a9b7c6',
    padding: 12,
    borderRadius: 8,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: '#3f3f74',
  },
  fence: {
    backgroundColor: '#0a0a14',
    color: '#a9b7c6',
    padding: 12,
    borderRadius: 8,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: '#3f3f74',
  },
  blockquote: {
    borderLeftWidth: 4,
    borderLeftColor: '#3f51b5',
    paddingLeft: 12,
    marginLeft: 0,
    marginVertical: 8,
    opacity: 0.9,
  },
  link: {
    color: '#64b5f6',
    textDecorationLine: 'underline',
  },
  bullet_list: {
    marginVertical: 6,
  },
  ordered_list: {
    marginVertical: 6,
  },
});
