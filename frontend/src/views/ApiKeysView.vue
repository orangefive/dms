<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <h2 class="page-title">API 密钥</h2>
        <p class="page-subtitle">供 n8n / 自动化脚本调用 REST API（Authorization: Bearer dms_xxx）</p>
      </div>
      <el-button v-if="auth.can('api-key:write')" type="primary" :icon="Plus" @click="openCreate">
        创建密钥
      </el-button>
    </div>

    <div class="card" style="padding: 8px 12px">
      <el-table v-loading="loading" :data="keys">
        <el-table-column prop="name" label="名称" min-width="140" />
        <el-table-column label="密钥前缀" width="150">
          <template #default="{ row }">
            <span class="mono text-secondary">{{ row.keyPrefix }}...</span>
          </template>
        </el-table-column>
        <el-table-column label="权限范围" min-width="220">
          <template #default="{ row }">
            <div class="dms-tags">
              <el-tag v-for="s in row.scopes" :key="s" size="small" effect="plain">{{ s }}</el-tag>
              <span v-if="row.scopes.length === 0" class="text-muted">无权限</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="创建人" width="110">
          <template #default="{ row }">{{ row.createdBy?.username ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="最近使用" width="160">
          <template #default="{ row }">{{ formatDateTime(row.lastUsedAt) }}</template>
        </el-table-column>
        <el-table-column label="过期时间" width="160">
          <template #default="{ row }">
            <span :style="row.expiresAt && new Date(row.expiresAt) < new Date() ? 'color: var(--dms-danger)' : ''">
              {{ formatDateTime(row.expiresAt) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-switch
              v-if="auth.can('api-key:write')"
              :model-value="row.isActive"
              @change="(v: boolean | string | number) => toggleActive(row, Boolean(v))"
            />
            <el-tag v-else size="small" :type="row.isActive ? 'success' : 'danger'" effect="plain">
              {{ row.isActive ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="auth.can('api-key:write')"
              size="small"
              text
              type="primary"
              @click="openEdit(row)"
            >
              编辑
            </el-button>
            <el-button
              v-if="auth.can('api-key:delete')"
              size="small"
              text
              type="danger"
              @click="removeKey(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && keys.length === 0" :image-size="60" description="还没有 API 密钥" />
    </div>

    <!-- 创建/编辑 -->
    <el-dialog v-model="dialogVisible" :title="editing ? '编辑密钥' : '创建 API 密钥'" width="560px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" maxlength="128" placeholder="例如：n8n 订单同步" />
        </el-form-item>
        <el-form-item label="过期时间">
          <el-date-picker
            v-model="form.expiresAt"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
            style="width: 100%"
            placeholder="留空表示永不过期"
          />
        </el-form-item>
        <el-form-item label="权限范围">
          <el-select v-model="form.scopes" multiple style="width: 100%" placeholder="留空 = 默认（记录读写 + 查询 + 导出）">
            <el-option v-for="p in ALL_SCOPES" :key="p" :label="p" :value="p" />
          </el-select>
          <div class="text-muted mt-8" style="font-size: 12px">
            留空时使用默认范围：数据查询/读写/导出（n8n 常用）。
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 创建成功：仅显示一次 -->
    <el-dialog v-model="keyDialog" title="密钥创建成功" width="560px" :close-on-click-modal="false">
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        title="完整密钥只显示这一次，请立即复制保存。数据库仅保存其哈希值，丢失后无法找回。"
        class="mb-16"
      />
      <div class="key-box">
        <code class="mono">{{ createdKey }}</code>
        <el-button size="small" type="primary" :icon="CopyDocument" @click="copyKey">复制</el-button>
      </div>
      <template #footer>
        <el-button type="primary" @click="keyDialog = false">我已保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { CopyDocument, Plus } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { apiKeyApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { confirmDanger, formatDateTime } from '@/utils/format';
import type { ApiKeyItem } from '@/types';

const auth = useAuthStore();

const ALL_SCOPES = [
  'project:read',
  'table:read',
  'table:write',
  'field:read',
  'field:write',
  'record:read',
  'record:write',
  'record:delete',
  'api-key:read',
  'export',
];

const keys = ref<ApiKeyItem[]>([]);
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const editing = ref<ApiKeyItem | null>(null);
const keyDialog = ref(false);
const createdKey = ref('');
const formRef = ref<FormInstance>();

const form = reactive({ name: '', expiresAt: '', scopes: [] as string[] });

const rules: FormRules = {
  name: [{ required: true, message: '请输入密钥名称', trigger: 'blur' }],
};

async function fetch(): Promise<void> {
  loading.value = true;
  try {
    keys.value = await apiKeyApi.list();
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  editing.value = null;
  Object.assign(form, { name: '', expiresAt: '', scopes: [] });
  dialogVisible.value = true;
}

function openEdit(key: ApiKeyItem): void {
  editing.value = key;
  Object.assign(form, {
    name: key.name,
    expiresAt: key.expiresAt ?? '',
    scopes: [...key.scopes],
  });
  dialogVisible.value = true;
}

async function save(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) {
    return;
  }
  saving.value = true;
  try {
    if (editing.value) {
      await apiKeyApi.update(editing.value.id, {
        name: form.name,
        scopes: form.scopes,
        expiresAt: form.expiresAt || null,
      });
      ElMessage.success('密钥已更新');
    } else {
      const res = await apiKeyApi.create({
        name: form.name,
        scopes: form.scopes,
        expiresAt: form.expiresAt || undefined,
      });
      createdKey.value = res.key;
      keyDialog.value = true;
      ElMessage.success('密钥已创建');
    }
    dialogVisible.value = false;
    await fetch();
  } finally {
    saving.value = false;
  }
}

async function toggleActive(key: ApiKeyItem, active: boolean): Promise<void> {
  await apiKeyApi.update(key.id, { isActive: active });
  ElMessage.success(active ? '密钥已启用' : '密钥已禁用');
  await fetch();
}

async function removeKey(key: ApiKeyItem): Promise<void> {
  const ok = await confirmDanger(`确定删除密钥「${key.name}」吗？使用它的脚本将立即失效。`);
  if (!ok) {
    return;
  }
  await apiKeyApi.remove(key.id);
  ElMessage.success('密钥已删除');
  await fetch();
}

async function copyKey(): Promise<void> {
  await navigator.clipboard.writeText(createdKey.value);
  ElMessage.success('已复制到剪贴板');
}

onMounted(fetch);
</script>

<style scoped>
.key-box {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #f8fafc;
  border: 1px solid var(--dms-border);
  border-radius: 8px;
  padding: 12px;
}

.key-box code {
  flex: 1;
  word-break: break-all;
  font-size: 13px;
}
</style>
