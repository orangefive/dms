<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <h2 class="page-title">用户管理</h2>
        <p class="page-subtitle">管理系统账号与角色分配</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreate">新建用户</el-button>
    </div>

    <div class="card" style="padding: 8px 12px">
      <el-table v-loading="loading" :data="users">
        <el-table-column label="用户名" min-width="140">
          <template #default="{ row }">
            <span class="mono">{{ row.username }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="displayName" label="显示名称" min-width="120" />
        <el-table-column prop="email" label="邮箱" min-width="180" />
        <el-table-column label="角色" min-width="180">
          <template #default="{ row }">
            <div class="dms-tags">
              <el-tag v-for="r in row.roles" :key="r.role.code" size="small" effect="plain" :type="roleTagType(r.role.code)">
                {{ r.role.name }}
              </el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.isActive ? 'success' : 'danger'" effect="plain">
              {{ row.isActive ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最近登录" width="170">
          <template #default="{ row }">{{ formatDateTime(row.lastLoginAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button
              size="small"
              text
              :type="row.isActive ? 'warning' : 'success'"
              @click="toggleActive(row)"
            >
              {{ row.isActive ? '禁用' : '启用' }}
            </el-button>
            <el-button size="small" text type="danger" @click="removeUser(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="flex-between mt-8" style="padding: 4px 8px">
        <span class="text-muted" style="font-size: 13px">共 {{ total }} 个用户</span>
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[100, 200, 300]"
          layout="sizes, prev, pager, next"
          background
          @current-change="fetch"
          @size-change="onSizeChange"
        />
      </div>
    </div>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑用户' : '新建用户'" width="520px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" :disabled="Boolean(editing)" maxlength="64" placeholder="字母数字 _ . -" />
        </el-form-item>
        <el-form-item label="显示名称" prop="displayName">
          <el-input v-model="form.displayName" maxlength="128" />
        </el-form-item>
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="form.email" maxlength="255" />
        </el-form-item>
        <el-form-item v-if="!editing" label="密码" prop="password">
          <el-input v-model="form.password" type="password" show-password placeholder="至少 8 位，含字母和数字" />
        </el-form-item>
        <el-form-item v-else label="重置密码">
          <el-input v-model="form.password" type="password" show-password placeholder="留空则不修改密码" />
        </el-form-item>
        <el-form-item label="角色" prop="roleCodes">
          <el-select v-model="form.roleCodes" multiple style="width: 100%" placeholder="选择角色">
            <el-option v-for="r in roles" :key="r.id" :label="`${r.name}（${r.code}）`" :value="r.code" />
          </el-select>
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
import { onMounted, reactive, ref } from 'vue';
import { Plus } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { roleApi, userApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { confirmDanger, formatDateTime } from '@/utils/format';
import type { RoleInfo, UserInfo } from '@/types';

const auth = useAuthStore();

const users = ref<UserInfo[]>([]);
const roles = ref<RoleInfo[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(300);
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const editing = ref<UserInfo | null>(null);
const formRef = ref<FormInstance>();

const form = reactive({
  username: '',
  displayName: '',
  email: '',
  password: '',
  roleCodes: [] as string[],
});

const rules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { pattern: /^[A-Za-z0-9_.-]{2,64}$/, message: '仅支持字母、数字、_ . -，长度 2-64', trigger: 'blur' },
  ],
  displayName: [{ required: true, message: '请输入显示名称', trigger: 'blur' }],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' },
  ],
  password: [
    {
      validator: (_r, v: string, cb) => {
        if (!editing.value && !v) {
          cb(new Error('请输入密码'));
        } else if (v && (v.length < 8 || !/[A-Za-z]/.test(v) || !/[0-9]/.test(v))) {
          cb(new Error('密码至少 8 位，且包含字母和数字'));
        } else {
          cb();
        }
      },
      trigger: 'blur',
    },
  ],
  roleCodes: [{ required: true, type: 'array', min: 1, message: '至少选择一个角色', trigger: 'change' }],
};

function roleTagType(code: string): 'danger' | 'warning' | 'info' {
  if (code === 'ADMIN') {
    return 'danger';
  }
  if (code === 'DEVELOPER') {
    return 'warning';
  }
  return 'info';
}

async function fetch(): Promise<void> {
  loading.value = true;
  try {
    const res = await userApi.list({ page: page.value, pageSize: pageSize.value });
    users.value = res.users;
    total.value = res.pagination.total;
  } finally {
    loading.value = false;
  }
}

function onSizeChange(): void {
  page.value = 1;
  void fetch();
}

function openCreate(): void {
  editing.value = null;
  Object.assign(form, { username: '', displayName: '', email: '', password: '', roleCodes: [] });
  dialogVisible.value = true;
}

function openEdit(user: UserInfo): void {
  editing.value = user;
  Object.assign(form, {
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    password: '',
    roleCodes: user.roles.map((r) => r.role.code),
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
      await userApi.update(editing.value.id, {
        displayName: form.displayName,
        email: form.email,
        roleCodes: form.roleCodes,
        ...(form.password ? { password: form.password } : {}),
      });
      ElMessage.success('用户已更新');
    } else {
      await userApi.create({
        username: form.username,
        displayName: form.displayName,
        email: form.email,
        password: form.password,
        roleCodes: form.roleCodes,
      });
      ElMessage.success('用户已创建');
    }
    dialogVisible.value = false;
    await fetch();
  } finally {
    saving.value = false;
  }
}

async function toggleActive(user: UserInfo): Promise<void> {
  if (user.id === auth.user?.id && user.isActive) {
    ElMessage.warning('不能禁用当前登录账号');
    return;
  }
  await userApi.update(user.id, { isActive: !user.isActive });
  ElMessage.success(user.isActive ? '用户已禁用' : '用户已启用');
  await fetch();
}

async function removeUser(user: UserInfo): Promise<void> {
  const ok = await confirmDanger(`确定删除用户「${user.username}」吗？`);
  if (!ok) {
    return;
  }
  try {
    await userApi.remove(user.id);
    ElMessage.success('用户已删除');
    await fetch();
  } catch {
    // 错误已由拦截器提示
  }
}

onMounted(async () => {
  roles.value = await roleApi.list();
  await fetch();
});
</script>
