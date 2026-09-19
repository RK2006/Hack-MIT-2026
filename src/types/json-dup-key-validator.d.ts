declare module 'json-dup-key-validator' {
  export function parse(input: string, allowDuplicatedKeys?: boolean): unknown;
  export function validate(input: string, allowDuplicatedKeys?: boolean): Error | undefined;
}
