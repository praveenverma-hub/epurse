import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { radius } from '../constants/theme';

const CategoryIcon = ({ category, size = 44 }) => {
  if (!category) return null;
  return (
    <View
      style={[
        styles.wrap,
        {
          width: size,
          height: size,
          borderRadius: radius.md,
          backgroundColor: category.color + '22', // ~13% alpha
        },
      ]}
    >
      <Text style={{ fontSize: size * 0.5 }}>{category.emoji}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});

export default CategoryIcon;
