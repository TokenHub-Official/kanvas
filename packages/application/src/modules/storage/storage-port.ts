export interface StorageObjectIdentity {
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly storageVersionId?: string;
}

export interface StorageByteRange {
  readonly start: string;
  readonly endInclusive: string;
}

export interface StorageObjectInspection {
  readonly identity: StorageObjectIdentity;
  readonly byteSize: string;
  readonly sha256: string;
  readonly immutableIdentityHash: string;
}

export interface StorageWriteRequest {
  readonly identity: StorageObjectIdentity;
  readonly maximumBytes: string;
  readonly body: AsyncIterable<Uint8Array>;
}

export interface StorageWriteResult extends StorageObjectInspection {
  readonly writeProtectionMode: "server_owned";
}

export interface StorageSealRequest {
  readonly identity: StorageObjectIdentity;
  readonly expectedByteSize: string;
  readonly expectedSha256: string;
}

export interface StorageReadRequest {
  readonly identity: StorageObjectIdentity;
  readonly expectedByteSize: string;
  readonly expectedSha256: string;
  readonly expectedImmutableIdentityHash: string;
  readonly range?: StorageByteRange;
}

export interface StorageReadHandle {
  readonly identity: StorageObjectIdentity;
  readonly totalByteSize: string;
  readonly contentByteSize: string;
  readonly range?: StorageByteRange;
  readonly body: AsyncIterable<Uint8Array>;
}

export interface StorageProviderReadUrlRequest {
  readonly identity: StorageObjectIdentity;
  readonly expectedByteSize: string;
  readonly expectedSha256: string;
  readonly expectedImmutableIdentityHash: string;
  readonly responseContentType: "image/jpeg" | "image/png" | "image/webp";
  readonly expiresInSeconds: number;
}

export interface StorageProviderReadUrl {
  readonly url: string;
  readonly expiresAt: Date;
}

export interface StorageDeleteResult {
  readonly disposition: "deleted" | "missing";
}

export interface StorageDeleteRequest {
  readonly identity: StorageObjectIdentity;
  readonly expectedByteSize: string;
  readonly expectedSha256: string;
  readonly expectedImmutableIdentityHash: string;
}

export interface StorageCapabilities {
  readonly uploadModes: readonly ["server_stream"];
  readonly writeProtectionModes: readonly ["server_owned"];
  readonly multipart: false;
  readonly fullObjectChecksum: true;
  readonly rangeRead: true;
  readonly versionBoundIdentity: false;
  readonly sealedIdentityImmutable: true;
  readonly deploymentScope: "single_node" | "distributed";
  readonly maximumObjectBytes: string;
  readonly serverSideEncryption:
    "not_provided" | "provider_managed" | "customer_managed";
}

export interface StoragePort {
  readonly storageProfileId: string;
  readonly kind: "local" | "s3" | "oss";
  readonly capabilities: StorageCapabilities;
  readonly writeObject: (
    request: StorageWriteRequest,
  ) => Promise<StorageWriteResult>;
  readonly sealObject: (
    request: StorageSealRequest,
  ) => Promise<StorageObjectInspection>;
  readonly inspectObject: (
    identity: StorageObjectIdentity,
  ) => Promise<StorageObjectInspection | undefined>;
  readonly openRead: (
    request: StorageReadRequest,
  ) => Promise<StorageReadHandle>;
  /**
   * Optional, provider-egress-only capability. Implementations must return a
   * bounded, short-lived URL and callers must never persist or log it.
   */
  readonly createProviderReadUrl?: (
    request: StorageProviderReadUrlRequest,
  ) => Promise<StorageProviderReadUrl>;
  readonly deleteObject: (
    request: StorageDeleteRequest,
  ) => Promise<StorageDeleteResult>;
  readonly cleanupUnpublishedObject: (
    identity: StorageObjectIdentity,
  ) => Promise<StorageDeleteResult>;
  readonly close?: () => void | Promise<void>;
  /** Recover provider-owned cleanup obligations, including ambiguous late writes. */
  readonly reconcileCleanup?: () => Promise<void>;
}

export interface RegisteredStorageProfile {
  readonly storageProfileId: string;
  readonly kind: StoragePort["kind"];
  readonly adapter: StoragePort;
}

export interface StorageProfileRegistry {
  resolve(storageProfileId: string): RegisteredStorageProfile | undefined;
}

export type ArtifactDataClassification =
  "internal" | "confidential" | "restricted";

export interface ArtifactDownloadAuthorizationRequest {
  readonly principalId: string;
  readonly workspaceId: string;
  readonly artifactId: string;
  readonly purpose: string;
  readonly now: Date;
}

export interface ArtifactDownloadAuthorizationAllow {
  readonly decision: "allow";
  readonly decisionId: string;
  readonly principalId: string;
  readonly workspaceId: string;
  readonly artifactId: string;
  readonly purpose: string;
  readonly dataClassification: ArtifactDataClassification;
  readonly authorizationVersion: number;
  readonly proxyRequired: boolean;
  readonly validUntil: Date;
}

export interface ArtifactDownloadAuthorizationDeny {
  readonly decision: "deny";
  readonly disclosure: "not_found" | "forbidden";
  readonly reasonCode: string;
}

export type ArtifactDownloadAuthorizationDecision =
  ArtifactDownloadAuthorizationAllow | ArtifactDownloadAuthorizationDeny;

export interface ArtifactDownloadAuthorizationPort {
  readonly authorize: (
    request: ArtifactDownloadAuthorizationRequest,
  ) => Promise<ArtifactDownloadAuthorizationDecision>;
  readonly revalidate: (
    decision: ArtifactDownloadAuthorizationAllow,
    now: Date,
  ) => Promise<ArtifactDownloadAuthorizationDecision>;
}

export interface DecodeVerificationRequest {
  readonly mediaType: "image/jpeg" | "image/png" | "image/webp";
  readonly bytes: Uint8Array;
  readonly structuralWidth: number;
  readonly structuralHeight: number;
  readonly maximumWidth: number;
  readonly maximumHeight: number;
  readonly maximumPixels: number;
  readonly maximumDecodedBytes: number;
}

export interface DecodeVerificationResult {
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
}

export interface DecodeVerifier {
  readonly verifyDecodedImage: (
    request: DecodeVerificationRequest,
  ) => Promise<DecodeVerificationResult>;
}
