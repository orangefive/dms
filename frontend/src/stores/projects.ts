import { defineStore } from 'pinia';
import { projectApi } from '@/api';
import type { Project } from '@/types';

export const useProjectStore = defineStore('projects', {
  state: () => ({
    projects: [] as Project[],
    loaded: false,
    loading: false,
  }),
  actions: {
    async fetch(withTables = true): Promise<void> {
      this.loading = true;
      try {
        this.projects = await projectApi.list(withTables);
        this.loaded = true;
      } finally {
        this.loading = false;
      }
    },
    async refresh(): Promise<void> {
      await this.fetch(true);
    },
  },
});
