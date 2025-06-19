declare module 'checksum' {
  interface ChecksumOptions {
    algorithm?: string;
    encoding?: string;
  }

  interface ChecksumStatic {
    file(filename: string, callback: (error: Error | null, hash: string) => void): void;
    file(filename: string, options: ChecksumOptions, callback: (error: Error | null, hash: string) => void): void;

    generate(data: string | Buffer, callback: (error: Error | null, hash: string) => void): void;
    generate(data: string | Buffer, options: ChecksumOptions, callback: (error: Error | null, hash: string) => void): void;
  }

  const checksum: ChecksumStatic;
  export = checksum;
  export default checksum;
}