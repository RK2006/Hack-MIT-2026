import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Native/ONNX and pg modules must stay in the Node runtime, not be bundled.
  serverExternalPackages: ['@xenova/transformers', 'onnxruntime-node', 'sharp', 'pg'],
};

export default nextConfig;
