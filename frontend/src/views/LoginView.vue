<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <div class="login-mark">D</div>
        <div>
          <h1 class="login-title">多维数据管理系统</h1>
          <p class="login-subtitle">数据可视化 · 精确查询 · 自动化接口</p>
        </div>
      </div>

      <el-form ref="formRef" :model="form" :rules="rules" size="large" @keyup.enter="submit">
        <el-form-item prop="username">
          <el-input v-model="form.username" placeholder="用户名或邮箱" :prefix-icon="User" clearable />
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="密码"
            :prefix-icon="Lock"
            show-password
          />
        </el-form-item>

        <el-alert
          v-if="errorMessage"
          :title="errorMessage"
          type="error"
          :closable="false"
          show-icon
          class="login-error"
        />

        <el-button type="primary" class="login-btn" :loading="loading" @click="submit">
          登 录
        </el-button>
      </el-form>

      <p class="login-footer">内部系统 · 请使用管理员分配的账号</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Lock, User } from '@element-plus/icons-vue';
import type { FormInstance, FormRules } from 'element-plus';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const formRef = ref<FormInstance>();
const loading = ref(false);
const errorMessage = ref('');

const form = reactive({ username: '', password: '' });

const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名或邮箱', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
};

async function submit(): Promise<void> {
  errorMessage.value = '';
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) {
    return;
  }
  loading.value = true;
  try {
    await auth.login(form.username.trim(), form.password);
    const redirect =
      typeof route.query.redirect === 'string' ? route.query.redirect : '/projects';
    await router.replace(redirect);
  } catch (err) {
    const e = err as { response?: { data?: { error?: { message?: string } } } };
    errorMessage.value = e.response?.data?.error?.message ?? '登录失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(1200px 500px at 20% -10%, #eef1fe 0%, transparent 60%),
    radial-gradient(900px 400px at 90% 110%, #f0f4fb 0%, transparent 55%),
    var(--dms-bg);
}

.login-card {
  width: 400px;
  background: #fff;
  border: 1px solid var(--dms-border);
  border-radius: 14px;
  box-shadow: var(--dms-shadow-lg);
  padding: 36px 36px 24px;
}

.login-brand {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 28px;
}

.login-mark {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--dms-primary), var(--dms-primary-strong));
  color: #fff;
  font-size: 22px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.login-title {
  font-size: 18px;
  margin: 0;
}

.login-subtitle {
  font-size: 12px;
  color: var(--dms-text-muted);
  margin: 4px 0 0;
}

.login-error {
  margin-bottom: 16px;
}

.login-btn {
  width: 100%;
  margin-top: 4px;
}

.login-footer {
  text-align: center;
  color: var(--dms-text-muted);
  font-size: 12px;
  margin-top: 20px;
}
</style>
