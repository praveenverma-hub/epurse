// =============================================================================
// ThreeDEngravedCoin — realistic minted ePurse reward coin.
//
// The source artwork is a transparent high-resolution 3D render. Keeping the
// component wrapper means reward surfaces can share one asset and control only
// its display size, while React Native chooses the correct device scale.
// =============================================================================

import React from 'react';
import { Image, type ImageStyle } from 'react-native';

type Props = {
  /** Display diameter in logical pixels. Defaults to 128. */
  size?: number;
};

const COIN = require('../../assets/epc-coin-realistic.png');

const ThreeDEngravedCoin: React.FC<Props> = ({ size = 128 }) => (
  <Image
    source={COIN}
    resizeMode="contain"
    style={{ width: size, height: size } as ImageStyle}
    accessible={false}
    accessibilityIgnoresInvertColors
  />
);

export default ThreeDEngravedCoin;
