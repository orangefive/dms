<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <h2 class="page-title">角色管理</h2>
        <p class="page-subtitle">系统内置角色（ADMIN / DEVELOPER / VIEWER）不可修改，可创建自定义角色</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreate">新建角色</el-button>
    </div>

    <div class="card" style="padding: 8px 12px">
      <el-table v-loading="loading" :data="roles">
        <el-table-column label="编码" width="140">
          <template #default="{ row }">
            <span class="mono">{{ row.code }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="名称" min-width="140" />
        <el-table-column prop="description" label="描述" min-width="240" show-overflow-tooltip />
        <el-table-column label="权限数" width="90" align="center">
          <template #default="{ row }">
            {{ row.permissions.includes('*') ? '全部' : row.permissions.length }}
          </template>
        </el-table-column>
        <el-table-column prop="userCount" label="用户数" width="80" align="center" />
        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="row.isSystem ? 'info' : 'success'" effect="plain">
              {{ row.isSystem ? '系统内置' : '自定义' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" :disabled="row.isSystem" @click="openEdit(row)">
              编辑权限
            </el-button>
            <el-button size="small" text type="danger" :disabled="row.isSystem" @click="removeRole(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑角色权限' : '新建角色'" width="640px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="编码" prop="code">
          <el-input v-model="form.code" :disabled="Boolean(editing)" maxlength="64" placeholder="如 OPS_MANAGER" class="mono" />
        </el-form-item>
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" maxlength="128" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" maxlength="512" />
        </el-form-item>
        <el-form-item label="权限">
          <div class="perm-groups">
            <div v-for="group in permissionGroups" :key="group.group" class="perm-group">
              <div class="perm-group-title">{{ group.label }}</div>
              <el-checkbox-group v-model="form.permissions">
                <el-checkbox v-for="p in group.permissions" :key="p.code" :value="p.code">
                  {{ p.label }}
                </el-checkbox>
              </el-checkbox-group>
            </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { Plus } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { roleApi } from '@/api';
import { confirmDanger } from '@/utils/format';
import type { RoleInfo } from '@/types';

interface PermissionGroup {
  group: string;
  label: string;
  permissions: Array<{ code: string; label: string }>;
}

const PERMISSION_GROUPS: PermissionGroup[] = [
  { group: 'project', label: '项目', permissions: [
    { code: 'project:read', label: '查看项目' },
    { code: 'project:write', label: '创建/编辑项目' },
    { code: 'project:delete', label: '删除项目' },
  ]},
  { group: 'table', label: '数据表', permissions: [
    { code: 'table:read', label: '查看数据表' },
    { code: 'table:write', label: '创建/编辑数据表' },
    { code: 'table:delete', label: '删除数据表' },
  ]},
  { group: 'field', label: '字段', permissions: [
    { code: 'field:read', label: '查看字段' },
    { code: 'field:write', label: '创建/编辑字段（含公式）' },
    { code: 'field:delete', label: '删除字段' },
  ]},
  { group: 'record', label: '数据', permissions: [
    { code: 'record:read', label: '查看/查询记录' },
    { code: 'record:write', label: '新增/修改/批量记录' },
    { code: 'record:delete', label: '删除记录' },
  ]},
  { group: 'api-key', label: 'API 密钥', permissions: [
    { code: 'api-key:read', label: '查看 API 密钥' },
    { code: 'api-key:write', label: '创建/编辑 API 密钥' },
    { code: 'api-key:delete', label: '删除 API 密钥' },
  ]},
  { group: 'export', label: '导出', permissions: [
    { code: 'export', label: 'Excel 导出' },
  ]},
  { group: 'user', label: '用户与审计', permissions: [
    { code: 'user:manage', label: '用户管理' },
    { code: 'role:manage', label: '角色管理' },
    { code: 'audit:read', label: '查看审计日志' },
  ]},
];

const roles = ref<RoleInfo[]>([]);
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const editing = ref<RoleInfo | null>(null);
const formRef = ref<FormInstance>();

const form = reactive({
  code: '',
  name: '',
  description: '',
  permissions: [] as string[],
});

const rules: FormRules = {
  code: [
    { required: true, message: '请输入角色编码', trigger: 'blur' },
    { pattern: /^[A-Z0-9_]{2,64}$/, message: '仅支持大写字母、数字、下划线', trigger: 'blur' },
  ],
  name: [{ required: true, message: '请输入角色名称', trigger: 'blur' }],
};

const permissionGroups = computed(() => PERMISSION_GROUPS);

async function fetch(): Promise<void> {
  loading.value = true;
  try {
    roles.value = await roleApi.list();
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  editing.value = null;
  Object.assign(form, { code: '', name: '', description: '', permissions: [] });
  dialogVisible.value = true;
}

function openEdit(role: RoleInfo): void {
  editing.value = role;
  Object.assign(form, {
    code: role.code,
    name: role.name,
    description: role.description ?? '',
    permissions: role.permissions.includes('*') ? [] : [...role.permissions],
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
      await roleApi.update(editing.value.id, {
        name: form.name,
        description: form.description,
        permissions: form.permissions,
      });
      ElMessage.success('角色已更新');
    } else {
      await roleApi.create({
        code: form.code,
        name: form.name,
        description: form.description,
        permissions: form.permissions,
      });
      ElMessage.success('角色已创建');
    }
    dialogVisible.value = false;
    await fetch();
  } finally {
    saving.value = false;
  }
}

async function removeRole(role: RoleInfo): Promise<void> {
  const ok = await confirmDanger(`确定删除角色「${role.name}」吗？`);
  if (!ok) {
    return;
  }
  try {
    await roleApi.remove(role.id);
    ElMessage.success('角色已删除');
    await fetch();
  } catch {
    // 拦截器提示
  }
}

onMounted(fetch);
</script>

<style scoped>
.perm-groups {
  width: 100%;
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--dms-border);
  border-radius: 6px;
  padding: 8px 12px;
}

.perm-group {
  margin-bottom: 10px;
}

.perm-group-title {
  font-size: 12px;
  color: var(--dms-text-secondary);
  margin-bottom: 6px;
  font-weight: 500;
}
</style>
