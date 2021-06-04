export const description = `
Validation tests for GPUBuffer.mapAsync, GPUBuffer.unmap and GPUBuffer.getMappedRange.

TODO: review existing tests and merge with this plan:
> - {mappedAtCreation, await mapAsync}
>     - -> x = getMappedRange
>     - check x.size == mapping size
>     - -> noawait mapAsync
>     - check x.size == mapping size
>     - -> await
>     - check x.size == mapping size
>     - -> unmap
>     - check x.size == 0
>     - -> getMappedRange (should fail)
> - await mapAsync -> await mapAsync -> getMappedRange
> - {mappedAtCreation, await mapAsync} -> unmap -> unmap
> - x = noawait mapAsync -> y = noawait mapAsync
>     - -> getMappedRange (should fail)
>     - -> await x
>     - -> getMappedRange
>     - -> shouldReject(y)
> - noawait mapAsync -> unmap
> - {mappedAtCreation, await mapAsync} -> x = getMappedRange -> unmap -> await mapAsync(subrange) -> y = getMappedRange
>     - check x.size == 0, y.size == mapping size
`;

import { makeTestGroup } from '../../../../common/framework/test_group.js';
import { attemptGarbageCollection } from '../../../../common/framework/util/collect_garbage.js';
import { assert, unreachable } from '../../../../common/framework/util/util.js';
import { kBufferUsages } from '../../../capability_info.js';
import { GPUConst } from '../../../constants.js';
import { ValidationTest } from '../validation_test.js';

class F extends ValidationTest {
  async testMapAsyncCall(
    success: boolean,
    rejectName: string | null,
    buffer: GPUBuffer,
    mode: GPUMapModeFlags,
    offset?: number,
    size?: number
  ) {
    if (success) {
      const p = buffer.mapAsync(mode, offset, size);
      await p;
    } else {
      let p: Promise<void>;
      this.expectValidationError(() => {
        p = buffer.mapAsync(mode, offset, size);
      });
      try {
        await p!;
        assert(rejectName === null, 'mapAsync unexpectedly passed');
      } catch (ex) {
        assert(rejectName === ex.name, `mapAsync rejected unexpectedly with: ${ex}`);
      }
    }
  }

  testGetMappedRangeCall(success: boolean, buffer: GPUBuffer, offset?: number, size?: number) {
    if (success) {
      const data = buffer.getMappedRange(offset, size);
      this.expect(data instanceof ArrayBuffer);
      if (size !== undefined) {
        this.expect(data.byteLength === size);
      }
    } else {
      this.shouldThrow('OperationError', () => {
        buffer.getMappedRange(offset, size);
      });
    }
  }

  createMappableBuffer(type: GPUMapModeFlags, size: number): GPUBuffer {
    switch (type) {
      case GPUMapMode.READ:
        return this.device.createBuffer({
          size,
          usage: GPUBufferUsage.MAP_READ,
        });
      case GPUMapMode.WRITE:
        return this.device.createBuffer({
          size,
          usage: GPUBufferUsage.MAP_WRITE,
        });
      default:
        unreachable();
    }
  }
}

export const g = makeTestGroup(F);

const kMapModeOptions = [GPUConst.MapMode.READ, GPUConst.MapMode.WRITE];
const kOffsetAlignment = 8;
const kSizeAlignment = 4;

g.test('mapAsync,usage')
  .desc(
    `Test the usage validation for mapAsync.

  For each buffer usage:
  For GPUMapMode.READ, GPUMapMode.WRITE, and 0:
    Test that the mapAsync call is valid iff the mapping usage is not 0 and the buffer usage
    the mapMode flag.`
  )
  .paramsSubcasesOnly(u =>
    u //
      .combine([
        { mapMode: GPUConst.MapMode.READ, validUsage: GPUConst.BufferUsage.MAP_READ },
        { mapMode: GPUConst.MapMode.WRITE, validUsage: GPUConst.BufferUsage.MAP_WRITE },
        // Using mapMode 0 is never valid, so there is no validUsage.
        { mapMode: 0, validUsage: null },
      ])
      .combineOptions('usage', kBufferUsages)
  )
  .fn(async t => {
    const { mapMode, validUsage, usage } = t.params;

    const buffer = t.device.createBuffer({
      size: 16,
      usage,
    });

    const success = usage === validUsage;
    await t.testMapAsyncCall(success, 'OperationError', buffer, mapMode);
  });

g.test('mapAsync,invalidBuffer')
  .desc('Test that mapAsync is an error when called on an invalid buffer.')
  .paramsSubcasesOnly(u => u.combineOptions('mapMode', kMapModeOptions))
  .fn(async t => {
    const { mapMode } = t.params;
    const buffer = t.getErrorBuffer();
    await t.testMapAsyncCall(false, 'OperationError', buffer, mapMode);
  });

g.test('mapAsync,state,destroyed')
  .desc('Test that mapAsync is an error when called on a destroyed buffer.')
  .paramsSubcasesOnly(u => u.combineOptions('mapMode', kMapModeOptions))
  .fn(async t => {
    const { mapMode } = t.params;
    const buffer = t.createMappableBuffer(mapMode, 16);
    buffer.destroy();
    await t.testMapAsyncCall(false, 'OperationError', buffer, mapMode);
  });

g.test('mapAsync,state,mappedAtCreation')
  .desc(
    `Test that mapAsync is an error when called on a buffer mapped at creation,
    but succeeds after unmapping it.`
  )
  .paramsSubcasesOnly([
    { mapMode: GPUConst.MapMode.READ, validUsage: GPUConst.BufferUsage.MAP_READ },
    { mapMode: GPUConst.MapMode.WRITE, validUsage: GPUConst.BufferUsage.MAP_WRITE },
  ])
  .fn(async t => {
    const { mapMode, validUsage } = t.params;

    const buffer = t.device.createBuffer({
      size: 16,
      usage: validUsage,
      mappedAtCreation: true,
    });
    await t.testMapAsyncCall(false, 'OperationError', buffer, mapMode);

    buffer.unmap();
    t.testMapAsyncCall(true, null, buffer, mapMode);
  });

g.test('mapAsync,state,mapped')
  .desc(
    `Test that mapAsync is an error when called on a mapped buffer, but succeeds
    after unmapping it.`
  )
  .paramsSubcasesOnly(u => u.combineOptions('mapMode', kMapModeOptions))
  .fn(async t => {
    const { mapMode } = t.params;

    const buffer = t.createMappableBuffer(mapMode, 16);
    await t.testMapAsyncCall(true, null, buffer, mapMode);
    await t.testMapAsyncCall(false, 'OperationError', buffer, mapMode);

    buffer.unmap();
    await t.testMapAsyncCall(true, null, buffer, mapMode);
  });

g.test('mapAsync,state,mappingPending')
  .desc(
    `Test that mapAsync is an error when called on a buffer that is being mapped,
    but succeeds after the previous mapping request is cancelled.`
  )
  .paramsSubcasesOnly(u => u.combineOptions('mapMode', kMapModeOptions))
  .fn(async t => {
    const { mapMode } = t.params;

    const buffer = t.createMappableBuffer(mapMode, 16);

    // Start mapping the buffer, we are going to unmap it before it resolves so it will reject
    // the mapping promise with an AbortError.
    t.shouldReject('AbortError', buffer.mapAsync(mapMode));

    // Do the test of mapAsync while [[state]] is mapping pending. It has to be synchronous so
    // that we can unmap the previous mapping in the same stack frame and check this one doesn't
    // get canceled, but instead is treated as a real error.
    t.expectValidationError(() => {
      t.shouldReject('OperationError', buffer.mapAsync(mapMode));
    });

    // Unmap the first mapping. It should now be possible to successfully call mapAsync
    buffer.unmap();
    await t.testMapAsyncCall(true, null, buffer, mapMode);
  });

g.test('mapAsync,sizeUnspecifiedOOB')
  .desc(
    `Test that mapAsync with size unspecified rejects if offset > buffer.[[size]],
    with various cases at the limits of the buffer size or with a misaligned offset.
    Also test for an empty buffer.`
  )
  .paramsSubcasesOnly(u =>
    u //
      .combineOptions('mapMode', kMapModeOptions)
      .combine([
        // 0 size buffer.
        { bufferSize: 0, offset: 0 },
        { bufferSize: 0, offset: 1 },
        { bufferSize: 0, offset: kOffsetAlignment },

        // Test with a buffer that's not empty.
        { bufferSize: 16, offset: 0 },
        { bufferSize: 16, offset: kOffsetAlignment },
        { bufferSize: 16, offset: 16 },
        { bufferSize: 16, offset: 17 },
        { bufferSize: 16, offset: 16 + kOffsetAlignment },
      ])
  )
  .fn(async t => {
    const { mapMode, bufferSize, offset } = t.params;
    const buffer = t.createMappableBuffer(mapMode, bufferSize);

    const success = offset <= bufferSize;
    await t.testMapAsyncCall(success, 'OperationError', buffer, mapMode, offset);
  });

g.test('mapAsync,offsetAndSizeAlignment')
  .desc("Test that mapAsync fails if the alignment of offset and size isn't correct.")
  .paramsSubcasesOnly(u =>
    u //
      .combineOptions('mapMode', kMapModeOptions)
      .combine([
        // Valid cases, 0 and required alignments values are valid.
        { offset: 0, size: 0 },
        { offset: kOffsetAlignment, size: kSizeAlignment },

        // Invalid case, offset isn't aligned.
        { offset: kOffsetAlignment / 2, size: kSizeAlignment },

        // Invalid case, size isn't aligned.
        { offset: kOffsetAlignment, size: kSizeAlignment / 2 },
      ])
  )
  .fn(async t => {
    const { mapMode, offset, size } = t.params;
    const buffer = t.createMappableBuffer(mapMode, 16);

    const success = offset % kOffsetAlignment === 0 && size % kSizeAlignment === 0;
    await t.testMapAsyncCall(success, 'OperationError', buffer, mapMode, offset, size);
  });

g.test('mapAsync,offsetAndSizeOOB')
  .desc('Test that mapAsync fails if offset + size is larger than the buffer size.')
  .paramsSubcasesOnly(u =>
    u //
      .combineOptions('mapMode', kMapModeOptions)
      .combine([
        // For a 0 size buffer
        { bufferSize: 0, offset: 0, size: 0 },
        { bufferSize: 0, offset: 0, size: 4 },
        { bufferSize: 0, offset: 8, size: 0 },

        // For a small buffer
        { bufferSize: 16, offset: 0, size: 16 },
        { bufferSize: 16, offset: kOffsetAlignment, size: 16 },

        { bufferSize: 16, offset: 16, size: 0 },
        { bufferSize: 16, offset: 16, size: kSizeAlignment },

        { bufferSize: 16, offset: 8, size: 0 },
        { bufferSize: 16, offset: 8, size: 8 },
        { bufferSize: 16, offset: 8, size: 8 + kSizeAlignment },

        // For a larger buffer
        { bufferSize: 1024, offset: 0, size: 1024 },
        { bufferSize: 1024, offset: kOffsetAlignment, size: 1024 },

        { bufferSize: 1024, offset: 1024, size: 0 },
        { bufferSize: 1024, offset: 1024, size: kSizeAlignment },

        { bufferSize: 1024, offset: 512, size: 0 },
        { bufferSize: 1024, offset: 512, size: 512 },
        { bufferSize: 1024, offset: 512, size: 512 + kSizeAlignment },
      ])
  )
  .fn(async t => {
    const { mapMode, bufferSize, size, offset } = t.params;
    const buffer = t.createMappableBuffer(mapMode, bufferSize);

    const success = offset + size <= bufferSize;
    await t.testMapAsyncCall(success, 'OperationError', buffer, mapMode, offset, size);
  });

g.test('getMappedRange,state,mapped')
  .desc('Test that it is valid to call getMappedRange in the mapped state')
  .paramsSubcasesOnly(u => u.combineOptions('mapMode', kMapModeOptions))
  .fn(async t => {
    const { mapMode } = t.params;
    const buffer = t.createMappableBuffer(mapMode, 16);
    await buffer.mapAsync(mapMode);

    t.testGetMappedRangeCall(true, buffer);
  });

g.test('getMappedRange,state,mappedAtCreation')
  .desc(
    'Test that it is valid to call getMappedRange in the mapped at creation state, for all buffer usages'
  )
  .paramsSubcasesOnly(u => u.combineOptions('bufferUsage', kBufferUsages))
  .fn(async t => {
    const { bufferUsage } = t.params;
    const buffer = t.device.createBuffer({
      usage: bufferUsage,
      size: 16,
      mappedAtCreation: true,
    });

    t.testGetMappedRangeCall(true, buffer);
  });

g.test('getMappedRange,state,unmapped')
  .desc(
    `Test that it is invalid to call getMappedRange in the unmapped state.
Test for various cases of being unmapped: at creation, after a mapAsync call or after being created mapped.`
  )
  .fn(async t => {
    // It is invalid to call getMappedRange when the buffer starts unmapped when created.
    {
      const buffer = t.createMappableBuffer(GPUMapMode.READ, 16);
      t.testGetMappedRangeCall(false, buffer);
    }

    // It is invalid to call getMappedRange when the buffer is unmapped after mapAsync.
    {
      const buffer = t.createMappableBuffer(GPUMapMode.READ, 16);
      await buffer.mapAsync(GPUMapMode.READ);
      buffer.unmap();
      t.testGetMappedRangeCall(false, buffer);
    }

    // It is invalid to call getMappedRange when the buffer is unmapped after mappedAtCreation.
    {
      const buffer = t.device.createBuffer({
        usage: GPUBufferUsage.MAP_READ,
        size: 16,
        mappedAtCreation: true,
      });
      buffer.unmap();
      t.testGetMappedRangeCall(false, buffer);
    }
  });

g.test('getMappedRange,state,destroyed')
  .desc(
    `Test that it is invalid to call getMappedRange in the destroyed state.
Test for various cases of being destroyed: at creation, after a mapAsync call or after being created mapped.`
  )
  .fn(async t => {
    // It is invalid to call getMappedRange when the buffer is destroyed when unmapped.
    {
      const buffer = t.createMappableBuffer(GPUMapMode.READ, 16);
      buffer.destroy();
      t.testGetMappedRangeCall(false, buffer);
    }

    // It is invalid to call getMappedRange when the buffer is destroyed when mapped.
    {
      const buffer = t.createMappableBuffer(GPUMapMode.READ, 16);
      await buffer.mapAsync(GPUMapMode.READ);
      buffer.destroy();
      t.testGetMappedRangeCall(false, buffer);
    }

    // It is invalid to call getMappedRange when the buffer is destroyed when mapped at creation.
    {
      const buffer = t.device.createBuffer({
        usage: GPUBufferUsage.MAP_READ,
        size: 16,
        mappedAtCreation: true,
      });
      buffer.destroy();
      t.testGetMappedRangeCall(false, buffer);
    }
  });

g.test('getMappedRange,state,mappingPending')
  .desc('Test that it is invalid to call getMappedRange in the mappingPending state.')
  .paramsSubcasesOnly(u => u.combineOptions('mapMode', kMapModeOptions))
  .fn(t => {
    const { mapMode } = t.params;
    const buffer = t.createMappableBuffer(mapMode, 16);

    /* noawait */ buffer.mapAsync(mapMode);
    t.testGetMappedRangeCall(false, buffer);
  });

g.test('getMappedRange,offsetAndSizeAlignment')
  .desc(
    `Test that getMappedRange fails if the alignment of offset and size isn't correct.
  TODO: x= {mappedAtCreation, mapAsync at {0, >0}`
  )
  .params(u =>
    u
      .combineOptions('mapMode', kMapModeOptions)
      .beginSubcases()
      .combine([
        // Valid cases, 0 and required alignments values are valid.
        { offset: 0, size: 0 },
        { offset: kOffsetAlignment, size: kSizeAlignment },

        // Invalid case, offset isn't aligned.
        { offset: kOffsetAlignment / 2, size: kSizeAlignment },

        // Invalid case, size isn't aligned.
        { offset: kOffsetAlignment, size: kSizeAlignment / 2 },
      ])
  )
  .fn(async t => {
    const { mapMode, offset, size } = t.params;
    const buffer = t.createMappableBuffer(mapMode, 16);
    await buffer.mapAsync(mapMode);

    const success = offset % kOffsetAlignment === 0 && size % kSizeAlignment === 0;
    t.testGetMappedRangeCall(success, buffer, offset, size);
  });

g.test('getMappedRange,sizeAndOffsetOOB,forMappedAtCreation')
  .desc(
    `Test that getMappedRange size + offset must be less than the buffer size for a
    buffer mapped at creation. (and offset has not constraints on its own)`
  )
  .paramsSubcasesOnly([
    // Tests for a zero-sized buffer, with and without a size defined.
    { bufferSize: 0, offset: undefined, size: undefined },
    { bufferSize: 0, offset: undefined, size: 0 },
    { bufferSize: 0, offset: undefined, size: kSizeAlignment },
    { bufferSize: 0, offset: 0, size: undefined },
    { bufferSize: 0, offset: 0, size: 0 },
    { bufferSize: 0, offset: kOffsetAlignment, size: undefined },
    { bufferSize: 0, offset: kOffsetAlignment, size: 0 },

    // Tests for a non-empty buffer, with an undefined offset.
    { bufferSize: 80, offset: undefined, size: 80 },
    { bufferSize: 80, offset: undefined, size: 80 + kSizeAlignment },

    // Tests for a non-empty buffer, with an undefined size.
    { bufferSize: 80, offset: undefined, size: undefined },
    { bufferSize: 80, offset: 0, size: undefined },
    { bufferSize: 80, offset: kOffsetAlignment, size: undefined },
    { bufferSize: 80, offset: 80, size: undefined },
    { bufferSize: 80, offset: 80 + kOffsetAlignment, size: undefined },

    // Tests for a non-empty buffer with a size defined.
    { bufferSize: 80, offset: 0, size: 80 },
    { bufferSize: 80, offset: 0, size: 80 + kSizeAlignment },
    { bufferSize: 80, offset: kOffsetAlignment, size: 80 },

    { bufferSize: 80, offset: 40, size: 40 },
    { bufferSize: 80, offset: 40 + kOffsetAlignment, size: 40 },
    { bufferSize: 80, offset: 40, size: 40 + kSizeAlignment },
  ])
  .fn(t => {
    const { bufferSize, offset, size } = t.params;
    const buffer = t.device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });

    const actualOffset = offset ?? 0;
    const actualSize = size ?? bufferSize - actualOffset;

    const success = actualOffset <= bufferSize && actualOffset + actualSize <= bufferSize;
    t.testGetMappedRangeCall(success, buffer, offset, size);
  });

g.test('getMappedRange,sizeAndOffsetOOB,forMapped')
  .desc('Test that getMappedRange size + offset must be less than the mapAsync range.')
  .paramsSubcasesOnly(u =>
    u //
      .combineOptions('mapMode', kMapModeOptions)
      .combine([
        // Tests for an empty buffer, and implicit mapAsync size.
        { bufferSize: 0, mapOffset: 0, mapSize: undefined, offset: undefined, size: undefined },
        { bufferSize: 0, mapOffset: 0, mapSize: undefined, offset: undefined, size: 0 },
        {
          bufferSize: 0,
          mapOffset: 0,
          mapSize: undefined,
          offset: undefined,
          size: kSizeAlignment,
        },
        { bufferSize: 0, mapOffset: 0, mapSize: undefined, offset: 0, size: undefined },
        { bufferSize: 0, mapOffset: 0, mapSize: undefined, offset: 0, size: 0 },
        {
          bufferSize: 0,
          mapOffset: 0,
          mapSize: undefined,
          offset: kOffsetAlignment,
          size: undefined,
        },
        { bufferSize: 0, mapOffset: 0, mapSize: undefined, offset: kOffsetAlignment, size: 0 },

        // Tests for an empty buffer, and explicit mapAsync size.
        { bufferSize: 0, mapOffset: 0, mapSize: 0, offset: undefined, size: undefined },
        { bufferSize: 0, mapOffset: 0, mapSize: 0, offset: 0, size: undefined },
        { bufferSize: 0, mapOffset: 0, mapSize: 0, offset: 0, size: 0 },
        { bufferSize: 0, mapOffset: 0, mapSize: 0, offset: kOffsetAlignment, size: undefined },
        { bufferSize: 0, mapOffset: 0, mapSize: 0, offset: kOffsetAlignment, size: 0 },

        // Test for a fully implicit mapAsync call
        { bufferSize: 80, mapOffset: undefined, mapSize: undefined, offset: 0, size: 80 },
        {
          bufferSize: 80,
          mapOffset: undefined,
          mapSize: undefined,
          offset: 0,
          size: 80 + kSizeAlignment,
        },
        {
          bufferSize: 80,
          mapOffset: undefined,
          mapSize: undefined,
          offset: kOffsetAlignment,
          size: 80,
        },

        // Test for a mapAsync call with an implicit size
        { bufferSize: 80, mapOffset: 24, mapSize: undefined, offset: 24, size: 80 - 24 },
        {
          bufferSize: 80,
          mapOffset: 24,
          mapSize: undefined,
          offset: 0,
          size: 80 - 24 + kSizeAlignment,
        },
        {
          bufferSize: 80,
          mapOffset: 24,
          mapSize: undefined,
          offset: kOffsetAlignment,
          size: 80 - 24,
        },

        // Test for a non-empty buffer fully mapped.
        { bufferSize: 80, mapOffset: 0, mapSize: 80, offset: 0, size: 80 },
        { bufferSize: 80, mapOffset: 0, mapSize: 80, offset: kOffsetAlignment, size: 80 },
        { bufferSize: 80, mapOffset: 0, mapSize: 80, offset: 0, size: 80 + kSizeAlignment },

        { bufferSize: 80, mapOffset: 0, mapSize: 80, offset: 40, size: 40 },
        { bufferSize: 80, mapOffset: 0, mapSize: 80, offset: 40 + kOffsetAlignment, size: 40 },
        { bufferSize: 80, mapOffset: 0, mapSize: 80, offset: 40, size: 40 + kSizeAlignment },

        // Test for a buffer partially mapped.
        { bufferSize: 80, mapOffset: 24, mapSize: 40, offset: 24, size: 40 },
        { bufferSize: 80, mapOffset: 24, mapSize: 40, offset: 24 - kOffsetAlignment, size: 40 },
        { bufferSize: 80, mapOffset: 24, mapSize: 40, offset: 24 + kOffsetAlignment, size: 40 },
        { bufferSize: 80, mapOffset: 24, mapSize: 40, offset: 24, size: 40 + kSizeAlignment },

        // Test for a partially mapped buffer with implicit size and offset for getMappedRange.
        // - Buffer partially mapped in the middle
        { bufferSize: 80, mapOffset: 24, mapSize: 40, offset: undefined, size: undefined },
        { bufferSize: 80, mapOffset: 24, mapSize: 40, offset: 0, size: undefined },
        { bufferSize: 80, mapOffset: 24, mapSize: 40, offset: 24, size: undefined },
        // - Buffer partially mapped to the end
        { bufferSize: 80, mapOffset: 24, mapSize: undefined, offset: 24, size: undefined },
        { bufferSize: 80, mapOffset: 24, mapSize: undefined, offset: 80, size: undefined },
        // - Buffer partially mapped from the start
        { bufferSize: 80, mapOffset: 0, mapSize: 64, offset: undefined, size: undefined },
        { bufferSize: 80, mapOffset: 0, mapSize: 64, offset: undefined, size: 64 },
      ])
  )
  .fn(async t => {
    const { mapMode, bufferSize, mapOffset, mapSize, offset, size } = t.params;
    const buffer = t.createMappableBuffer(mapMode, bufferSize);
    await buffer.mapAsync(mapMode, mapOffset, mapSize);

    const actualMapOffset = mapOffset ?? 0;
    const actualMapSize = mapSize ?? bufferSize - actualMapOffset;

    const actualOffset = offset ?? 0;
    const actualSize = size ?? bufferSize - actualOffset;

    const success =
      actualOffset >= actualMapOffset &&
      actualOffset <= bufferSize &&
      actualOffset + actualSize <= actualMapOffset + actualMapSize;
    t.testGetMappedRangeCall(success, buffer, offset, size);
  });

g.test('getMappedRange,disjointRanges')
  .desc('Test that the ranges asked through getMappedRange must be disjoint.')
  .paramsSubcasesOnly(u =>
    u //
      .combineOptions('remapBetweenCalls', [false, true])
      .combine([
        // Disjoint ranges with one that's empty.
        { offset1: 8, size1: 0, offset2: 8, size2: 8 },
        { offset1: 16, size1: 0, offset2: 8, size2: 8 },

        { offset1: 8, size1: 8, offset2: 8, size2: 0 },
        { offset1: 8, size1: 8, offset2: 16, size2: 0 },

        // Disjoint ranges with both non-empty.
        { offset1: 0, size1: 8, offset2: 8, size2: 8 },
        { offset1: 16, size1: 8, offset2: 8, size2: 8 },

        { offset1: 8, size1: 8, offset2: 0, size2: 8 },
        { offset1: 8, size1: 8, offset2: 16, size2: 8 },

        // Empty range contained inside another one.
        { offset1: 16, size1: 20, offset2: 24, size2: 0 },
        { offset1: 24, size1: 0, offset2: 16, size2: 20 },

        // Ranges that overlap only partially.
        { offset1: 16, size1: 20, offset2: 8, size2: 20 },
        { offset1: 16, size1: 20, offset2: 32, size2: 20 },

        // Ranges that include one another.
        { offset1: 0, size1: 80, offset2: 16, size2: 20 },
        { offset1: 16, size1: 20, offset2: 0, size2: 80 },
      ])
  )
  .fn(async t => {
    const { offset1, size1, offset2, size2, remapBetweenCalls } = t.params;
    const buffer = t.device.createBuffer({ size: 80, usage: GPUBufferUsage.MAP_READ });
    await buffer.mapAsync(GPUMapMode.READ);

    t.testGetMappedRangeCall(true, buffer, offset1, size1);

    if (remapBetweenCalls) {
      buffer.unmap();
      await buffer.mapAsync(GPUMapMode.READ);
    }

    const range1StartsAfter2 = offset1 >= offset2 + size2;
    const range2StartsAfter1 = offset2 >= offset1 + size1;
    const disjoint = range1StartsAfter2 || range2StartsAfter1;
    const success = disjoint || remapBetweenCalls;

    t.testGetMappedRangeCall(success, buffer, offset2, size2);
  });

g.test('getMappedRange,disjoinRanges_many')
  .desc('Test getting a lot of small ranges, and that the disjoint check checks them all.')
  .fn(async t => {
    const kStride = 256;
    const kNumStrides = 256;

    const buffer = t.device.createBuffer({
      size: kStride * kNumStrides,
      usage: GPUBufferUsage.MAP_READ,
    });
    await buffer.mapAsync(GPUMapMode.READ);

    // Get a lot of small mapped ranges.
    for (let stride = 0; stride < kNumStrides; stride++) {
      t.testGetMappedRangeCall(true, buffer, stride * kStride, 8);
    }

    // Check for each range it is invalid to get a range that overlaps it and check that it is valid
    // to get ranges for the rest of the buffer.
    for (let stride = 0; stride < kNumStrides; stride++) {
      t.testGetMappedRangeCall(false, buffer, stride * kStride, kStride);
      t.testGetMappedRangeCall(true, buffer, stride * kStride + 8, kStride - 8);
    }
  });

g.test('unmap,state,unmapped')
  .desc(
    `Test it is invalid to call unmap on a buffer that is unmapped (at creation, or after
    mappedAtCreation or mapAsync)`
  )
  .fn(async t => {
    // It is invalid to call unmap after creation of an unmapped buffer.
    {
      const buffer = t.device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ });
      t.expectValidationError(() => {
        buffer.unmap();
      });
    }

    // It is invalid to call unmap after unmapping a mapAsynced buffer.
    {
      const buffer = t.createMappableBuffer(GPUMapMode.READ, 16);
      await buffer.mapAsync(GPUMapMode.READ);
      buffer.unmap();
      t.expectValidationError(() => {
        buffer.unmap();
      });
    }

    // It is invalid to call unmap after unmapping a mappedAtCreation buffer.
    {
      const buffer = t.device.createBuffer({
        usage: GPUBufferUsage.MAP_READ,
        size: 16,
        mappedAtCreation: true,
      });
      buffer.unmap();
      t.expectValidationError(() => {
        buffer.unmap();
      });
    }
  });

g.test('unmap,state,destroyed')
  .desc(
    `Test it is invalid to call unmap on a buffer that is destroyed (at creation, or after
    mappedAtCreation or mapAsync)`
  )
  .fn(async t => {
    // It is invalid to call unmap after destruction of an unmapped buffer.
    {
      const buffer = t.device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ });
      buffer.destroy();
      t.expectValidationError(() => {
        buffer.unmap();
      });
    }

    // It is invalid to call unmap after destroying a mapAsynced buffer.
    {
      const buffer = t.createMappableBuffer(GPUMapMode.READ, 16);
      await buffer.mapAsync(GPUMapMode.READ);
      buffer.destroy();
      t.expectValidationError(() => {
        buffer.unmap();
      });
    }

    // It is invalid to call unmap after destroying a mappedAtCreation buffer.
    {
      const buffer = t.device.createBuffer({
        usage: GPUBufferUsage.MAP_READ,
        size: 16,
        mappedAtCreation: true,
      });
      buffer.destroy();
      t.expectValidationError(() => {
        buffer.unmap();
      });
    }
  });

g.test('unmap,state,mappedAtCreation')
  .desc('Test it is valid to call unmap on a buffer mapped at creation, for various usages')
  .paramsSubcasesOnly(u =>
    u //
      .combineOptions('bufferUsage', kBufferUsages)
  )
  .fn(t => {
    const { bufferUsage } = t.params;
    const buffer = t.device.createBuffer({ size: 16, usage: bufferUsage, mappedAtCreation: true });

    buffer.unmap();
  });

g.test('unmap,state,mapped')
  .desc("Test it is valid to call unmap on a buffer that's mapped")
  .paramsSubcasesOnly(u => u.combineOptions('mapMode', kMapModeOptions))
  .fn(async t => {
    const { mapMode } = t.params;
    const buffer = t.createMappableBuffer(mapMode, 16);

    await buffer.mapAsync(mapMode);
    buffer.unmap();
  });

g.test('unmap,state,mappingPending')
  .desc("Test it is valid to call unmap on a buffer that's being mapped")
  .paramsSubcasesOnly(u => u.combineOptions('mapMode', kMapModeOptions))
  .fn(t => {
    const { mapMode } = t.params;
    const buffer = t.createMappableBuffer(mapMode, 16);

    const mapping = buffer.mapAsync(mapMode);
    t.shouldReject('AbortError', mapping);

    buffer.unmap();
  });

g.test('gc_behavior,mappedAtCreation')
  .desc(
    "Test that GCing the buffer while mappings are handed out doesn't invalidate them - mappedAtCreation case"
  )
  .fn(async t => {
    let buffer = null;
    buffer = t.device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });

    // Write some non-zero data to the buffer.
    const contents = new Uint32Array(buffer.getMappedRange());
    for (let i = 0; i < contents.length; i++) {
      contents[i] = i;
    }

    // Trigger garbage collection that should collect the buffer (or as if it collected it)
    // NOTE: This won't fail unless the browser immediately starts reusing the memory, or gives it
    // back to the OS. One good option for browsers to check their logic is good is to zero-out the
    // memory on GPUBuffer (or internal gpu::Buffer-like object) destruction.
    buffer = null;
    await attemptGarbageCollection();

    // Use the mapping again both for read and write, it should work.
    for (let i = 0; i < contents.length; i++) {
      t.expect(contents[i] === i);
      contents[i] = i + 1;
    }
  });

g.test('gc_behavior,mapAsync')
  .desc(
    "Test that GCing the buffer while mappings are handed out doesn't invalidate them - mapAsync case"
  )
  .paramsSubcasesOnly(u => u.combineOptions('mapMode', kMapModeOptions))
  .fn(async t => {
    const { mapMode } = t.params;

    let buffer = null;
    buffer = t.createMappableBuffer(mapMode, 256);
    await buffer.mapAsync(mapMode);

    // Write some non-zero data to the buffer.
    const contents = new Uint32Array(buffer.getMappedRange());
    for (let i = 0; i < contents.length; i++) {
      contents[i] = i;
    }

    // Trigger garbage collection that should collect the buffer (or as if it collected it)
    // NOTE: This won't fail unless the browser immediately starts reusing the memory, or gives it
    // back to the OS. One good option for browsers to check their logic is good is to zero-out the
    // memory on GPUBuffer (or internal gpu::Buffer-like object) destruction.
    buffer = null;
    await attemptGarbageCollection();

    // Use the mapping again both for read and write, it should work.
    for (let i = 0; i < contents.length; i++) {
      t.expect(contents[i] === i);
      contents[i] = i + 1;
    }
  });
