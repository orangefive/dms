<template>
  <div class="page-container">
    <h2 class="page-title">个人设置</h2>

    <div class="settings-grid">
      <div class="card settings-card">
        <h3 class="settings-title">账号信息</h3>
        <el-descriptions :column="1" border>
          <el-descriptions-item label="用户名">
            <span class="mono">{{ auth.user?.username }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="显示名称">{{ auth.user?.displayName }}</el-descriptions-item>
          <el-descriptions-item label="邮箱">{{ auth.user?.email }}</el-descriptions-item>
          <el-descriptions-item label="角色">
            <div class="dms-tags">
              <el-tag v-for="r in auth.user?.roles ?? []" :key="r.code" size="small" effect="plain">
                {{ r.name }}（{{ r.code }}）
              </el-tag>
            </div>
          </el-descriptions-item>
        </el-descriptions>
      </div>

      <div class="card settings-card">
        <h3 class="settings-title">修改密码</h3>
        <el-form ref="formRef" :model="form" :rules="rules" label-width="90px" style="max-width: 420px">
          <el-form-item label="原密码" prop="oldPassword">
            <el-input v-model="form.oldPassword" type="password" show-password />
          </el-form-item>
          <el-form-item label="新密码" prop="newPassword">
            <el-input v-model="form.newPassword" type="password" show-password placeholder="至少 8 位，含字母和数字" />
          </el-form-item>
          <el-form-item label="确认密码" prop="confirm">
            <el-input v-model="form.confirm" type="password" show-password />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="saving" @click="submit">更新密码</el-button>
          </el-form-item>
        </el-form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { authApi } from '@/api';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const formRef = ref<FormInstance>();
const saving = ref(false);

const form = reactive({ oldPassword: '', newPassword: '', confirm: '' });

const rules: FormRules = {
  oldPassword: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, message: '密码至少 8 位', trigger: 'blur' },
    {
      pattern: /^(?=.*[A-Za-z])(?=.*\d).+$/,
      message: '必须同时包含字母和数字',
      trigger: 'blur',
    },
  ],
  confirm: [
    {
      validator: (_r, v: string, cb) => {
        if (v !== form.newPassword) {
          cb(new Error('两次输入的密码不一致'));
        } else {
          cb();
        }
      },
      trigger: 'blur',
    },
  ],
};

async function submit(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) {
    return;
  }
  saving.value = true;
  try {
    await authApi.changePassword(form.oldPassword, form.newPassword);
    ElMessage.success('密码已更新，请重新登录');
    Object.assign(form, { oldPassword: '', newPassword: '', confirm: '' });
    setTimeout(() => {
      void auth.logout().then(() => {
        window.location.href = '/login';
      });
    }, 800);
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
  gap: 16px;
  margin-top: 16px;
}

.settings-card {
  padding: 20px;
}

.settings-title {
  font-size: 15px;
  margin: 0 0 16px;
}
</style>
