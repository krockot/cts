/**
 * AUTO-GENERATED - DO NOT EDIT. Source: https://github.com/gpuweb/cts
 **/
export function createQuerySetWithType(t, type, count) {
  return t.device.createQuerySet({
    type,
    count,
    pipelineStatistics: type === 'pipeline-statistics' ? ['clipper-invocations'] : [],
  });
}

export function beginRenderPassWithQuerySet(t, encoder, querySet) {
  const view = t.device
    .createTexture({
      format: 'rgba8unorm',
      size: { width: 16, height: 16, depthOrArrayLayers: 1 },
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
    .createView();
  return encoder.beginRenderPass({
    colorAttachments: [
      {
        view,
        loadValue: { r: 1.0, g: 0.0, b: 0.0, a: 1.0 },
        storeOp: 'store',
      },
    ],

    occlusionQuerySet: querySet,
  });
}

export function createRenderEncoderWithQuerySet(t, querySet) {
  const commandEncoder = t.device.createCommandEncoder();
  const encoder = beginRenderPassWithQuerySet(t, commandEncoder, querySet);
  return {
    encoder,
    finish: () => {
      encoder.endPass();
      return commandEncoder.finish();
    },
  };
}