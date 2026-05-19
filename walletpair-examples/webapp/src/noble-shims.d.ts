// Noble v2 exports use .js suffixes which TS can't resolve via dynamic import.
// These shims satisfy the type checker while Vite handles actual resolution.
declare module '@noble/curves/secp256k1.js' {
	export { secp256k1 } from '@noble/curves/secp256k1';
}
declare module '@noble/hashes/sha3.js' {
	export { keccak_256 } from '@noble/hashes/sha3';
}
declare module '@noble/hashes/utils.js' {
	export { utf8ToBytes, concatBytes, bytesToHex } from '@noble/hashes/utils';
}
