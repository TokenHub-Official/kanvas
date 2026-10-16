import { resolve } from "node:path";

import type { PoolConnection } from "mysql2/promise";

import {
  bootstrapImageCompositionWorkflow,
  type ImageCompositionWorkflowDescriptor,
} from "./bootstrap-image-composition-workflow.js";

const packRoot = (name: string): string =>
  resolve(
    import.meta.dirname,
    `../../../../scenario-packs/first-party/${name}`,
  );

export const textRemoveWorkflowDescriptor: ImageCompositionWorkflowDescriptor =
  Object.freeze({
    scenarioKey: "first-party.image-text-remove",
    workflowKey: "image_text_remove",
    entrypointKey: "remove-text",
    revision: 1,
    workflowFile: "image-text-remove.json",
    packRoot: packRoot("image-text-remove"),
    ids: Object.freeze({
      workflowRevision: "01K00000000000000000000200",
      sourceDraft: "01K00000000000000000000203",
    }),
  });

export const layersSeparateWorkflowDescriptor: ImageCompositionWorkflowDescriptor =
  Object.freeze({
    scenarioKey: "first-party.image-layers-separate",
    workflowKey: "image_layers_separate",
    entrypointKey: "separate",
    revision: 1,
    workflowFile: "image-layers-separate.json",
    packRoot: packRoot("image-layers-separate"),
    ids: Object.freeze({
      workflowRevision: "01K00000000000000000000210",
      sourceDraft: "01K00000000000000000000213",
    }),
  });

export const posterGenerateSimpleWorkflowDescriptor: ImageCompositionWorkflowDescriptor =
  Object.freeze({
    scenarioKey: "first-party.poster-generate-simple",
    workflowKey: "poster_generate_simple",
    entrypointKey: "generate",
    revision: 1,
    workflowFile: "poster-generate-simple.json",
    packRoot: packRoot("poster-generate-simple"),
    authoring: Object.freeze({
      definitionId: "01K00000000000000000000404",
      displayName: "基础海报生成",
      description: "输入海报需求，流程组合内置提示词并生成一张结果图。",
      category: "海报制作",
    }),
    ids: Object.freeze({
      workflowRevision: "01K00000000000000000000400",
      sourceDraft: "01K00000000000000000000403",
    }),
  });

export const posterGenerateCompleteWorkflowDescriptor: ImageCompositionWorkflowDescriptor =
  Object.freeze({
    scenarioKey: "first-party.poster-generate-complete",
    workflowKey: "poster_generate_complete",
    entrypointKey: "generate",
    revision: 1,
    workflowFile: "poster-generate-complete.json",
    packRoot: packRoot("poster-generate-complete"),
    authoring: Object.freeze({
      definitionId: "01K00000000000000000000414",
      displayName: "完整海报生成",
      description: "根据是否提供参考图自动选择图片生成或图片编辑流程。",
      category: "海报制作",
    }),
    ids: Object.freeze({
      workflowRevision: "01K00000000000000000000410",
      sourceDraft: "01K00000000000000000000413",
    }),
  });

export const posterComposeSubjectWorkflowDescriptor: ImageCompositionWorkflowDescriptor =
  Object.freeze({
    scenarioKey: "first-party.poster-compose-subject",
    workflowKey: "poster_compose_subject",
    entrypointKey: "compose",
    revision: 1,
    workflowFile: "poster-compose-subject.json",
    packRoot: packRoot("poster-compose-subject"),
    authoring: Object.freeze({
      definitionId: "01K00000000000000000000424",
      displayName: "主体生成并融入背景",
      description: "生成主体、提取透明前景与蒙版，再合成到指定背景图。",
      category: "海报制作",
    }),
    ids: Object.freeze({
      workflowRevision: "01K00000000000000000000420",
      sourceDraft: "01K00000000000000000000423",
    }),
  });

export const brandSocialStarterWorkflowDescriptor: ImageCompositionWorkflowDescriptor =
  Object.freeze({
    scenarioKey: "first-party.brand-social-starter",
    workflowKey: "brand_social_starter",
    entrypointKey: "compose",
    revision: 2,
    workflowFile: "brand-social-starter.json",
    packRoot: packRoot("brand-social-starter"),
    authoring: Object.freeze({
      definitionId: "01K00000000000000000000434",
      displayName: "品牌底图合成",
      description:
        "将已确认的品牌 Logo 合成到纯色方形底图，不包含完整海报排版。",
      category: "品牌创作",
    }),
    ids: Object.freeze({
      workflowRevision: "01K00000000000000000000450",
      sourceDraft: "01K00000000000000000000433",
    }),
  });

export const imageGenerateWorkflowDescriptor: ImageCompositionWorkflowDescriptor =
  Object.freeze({
    scenarioKey: "first-party.image-generate",
    workflowKey: "image_generate",
    entrypointKey: "generate",
    revision: 2,
    workflowFile: "image-generate.json",
    packRoot: packRoot("image-generate"),
    authoring: Object.freeze({
      definitionId: "01K00000000000000000000444",
      displayName: "图片生成",
      description: "根据视觉要求生成一张可追踪的图片结果。",
      category: "生成与编辑",
    }),
    ids: Object.freeze({
      workflowRevision: "01K00000000000000000000460",
      sourceDraft: "01K00000000000000000000443",
    }),
  });

export async function bootstrapImageCompositionWorkflows(
  connection: PoolConnection,
  options: {
    readonly actorId: string;
    readonly workspaceId: string;
  },
) {
  const textRemove = await bootstrapImageCompositionWorkflow(connection, {
    ...options,
    descriptor: textRemoveWorkflowDescriptor,
  });
  const layersSeparate = await bootstrapImageCompositionWorkflow(connection, {
    ...options,
    descriptor: layersSeparateWorkflowDescriptor,
  });
  const posterGenerateSimple = await bootstrapImageCompositionWorkflow(
    connection,
    {
      ...options,
      descriptor: posterGenerateSimpleWorkflowDescriptor,
    },
  );
  const posterGenerateComplete = await bootstrapImageCompositionWorkflow(
    connection,
    {
      ...options,
      descriptor: posterGenerateCompleteWorkflowDescriptor,
    },
  );
  const posterComposeSubject = await bootstrapImageCompositionWorkflow(
    connection,
    {
      ...options,
      descriptor: posterComposeSubjectWorkflowDescriptor,
    },
  );
  const brandSocialStarter = await bootstrapImageCompositionWorkflow(
    connection,
    {
      ...options,
      descriptor: brandSocialStarterWorkflowDescriptor,
    },
  );
  const imageGenerate = await bootstrapImageCompositionWorkflow(connection, {
    ...options,
    descriptor: imageGenerateWorkflowDescriptor,
  });
  return Object.freeze({
    textRemove,
    layersSeparate,
    posterGenerateSimple,
    posterGenerateComplete,
    posterComposeSubject,
    brandSocialStarter,
    imageGenerate,
  });
}
