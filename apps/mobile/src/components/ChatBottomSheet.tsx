import React, { forwardRef, useMemo, useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import BottomSheet, {
  BottomSheetView,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { PencilIcon } from './ChatHeader';
import Svg, { Path, SvgProps } from 'react-native-svg';

// ─── TrashIcon SVG ───────────────────────────────────────────────────────────

export const TrashIcon = (props: SvgProps) => (
  <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" {...props}>
    <Path
      d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"
      stroke={props.color || '#333333'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

interface ChatBottomSheetProps {
  onRename: () => void;
  onDelete: () => void;
}

export const ChatBottomSheet = forwardRef<BottomSheet, ChatBottomSheetProps>(
  ({ onRename, onDelete }, ref) => {
    // snap points: 200px or approximately 25% height is perfect for these two buttons
    const snapPoints = useMemo(() => ['25%'], []);

    // Backdrop rendering for dimmed background
    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={0.5}
          enableTouchThrough={false}
        />
      ),
      []
    );

    return (
      <BottomSheet
        ref={ref}
        index={-1} // Closed initially
        snapPoints={snapPoints}
        enablePanDownToClose={true}
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.bottomSheetBackground}
        handleIndicatorStyle={styles.handleIndicator}
      >
        <BottomSheetView style={styles.contentContainer}>
          {/* 1. Rename Button */}
          <TouchableOpacity
            style={styles.itemButton}
            onPress={onRename}
            activeOpacity={0.6}
          >
            <PencilIcon color="#333333" style={styles.icon} />
            <Text style={styles.itemText}>이름변경</Text>
          </TouchableOpacity>

          {/* Divider */}
          <View style={styles.divider} />

          {/* 2. Delete Button (Red) */}
          <TouchableOpacity
            style={styles.itemButton}
            onPress={onDelete}
            activeOpacity={0.6}
          >
            <TrashIcon color="#D93025" style={styles.icon} />
            <Text style={[styles.itemText, styles.deleteText]}>삭제</Text>
          </TouchableOpacity>
        </BottomSheetView>
      </BottomSheet>
    );
  }
);

ChatBottomSheet.displayName = 'ChatBottomSheet';

const styles = StyleSheet.create({
  bottomSheetBackground: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  handleIndicator: {
    backgroundColor: '#E0E0E0',
    width: 40,
  },
  contentContainer: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  itemButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
  },
  icon: {
    marginRight: 16,
  },
  itemText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333333',
  },
  deleteText: {
    color: '#D93025',
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: '#F0F0F0',
    marginHorizontal: 4,
  },
});
