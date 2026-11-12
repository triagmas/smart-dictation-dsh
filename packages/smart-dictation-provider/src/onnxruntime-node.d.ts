declare module 'onnxruntime-node' {
  export class Tensor {
    constructor(type: 'float32' | 'int64', data: Float32Array | BigInt64Array, dims: readonly number[])
    readonly data: Float32Array | BigInt64Array
    readonly dims: readonly number[]
  }

  export class InferenceSession {
    static create(path: string, options?: Record<string, unknown>): Promise<InferenceSession>
    run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array | BigInt64Array; dims: readonly number[] }>>
    release(): Promise<void>
  }
}
