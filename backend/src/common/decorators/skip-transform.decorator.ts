import { SetMetadata } from '@nestjs/common';

export const SKIP_TRANSFORM_KEY = 'skipTransform';

/** 标记响应不需要统一包装（例如文件流导出） */
export const SkipTransform = () => SetMetadata(SKIP_TRANSFORM_KEY, true);
