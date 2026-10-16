export const imageProviderSharedPolicyIds = Object.freeze({
  instancePolicyRevision: "01K0000000000000000000005C",
  workspacePolicyRevision: "01K0000000000000000000005D",
});

export const openAiImagesResourceIds = Object.freeze({
  endpoint: "01K0000000000000000000003C",
  credential: "01K0000000000000000000003D",
  secretVersion: "01K0000000000000000000003E",
  modelProfileRevision: "01K0000000000000000000003F",
  modelDeployment: "01K0000000000000000000003G",
  pricingRevision: "01K0000000000000000000003H",
  routePolicyRevision: "01K0000000000000000000003J",
  budgetAccount: "01K0000000000000000000003K",
});

export const generationTasksImagesResourceIds = Object.freeze({
  endpoint: "01K0000000000000000000004C",
  credential: "01K0000000000000000000004D",
  secretVersion: "01K0000000000000000000004E",
  modelProfileRevision: "01K0000000000000000000004F",
  modelDeployment: "01K0000000000000000000004G",
  pricingRevision: "01K0000000000000000000004H",
  routePolicyRevision: "01K0000000000000000000004J",
  budgetAccount: "01K0000000000000000000004K",
});

export const allImageProviderEndpointIds = Object.freeze([
  openAiImagesResourceIds.endpoint,
  generationTasksImagesResourceIds.endpoint,
]);
