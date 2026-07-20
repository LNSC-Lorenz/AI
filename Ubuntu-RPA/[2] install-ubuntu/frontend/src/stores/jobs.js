import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '../api'

export const useJobsStore = defineStore('jobs', () => {
  const jobs = ref([])
  const deployments = ref([])
  const loading = ref(false)
  const error = ref(null)

  const completedJobs = computed(() => jobs.value.filter(j => j.state?.type === 'COMPLETED'))
  const failedJobs = computed(() => jobs.value.filter(j => j.state?.type === 'FAILED'))
  const runningJobs = computed(() => jobs.value.filter(j => j.state?.type === 'RUNNING'))
  const pendingJobs = computed(() => jobs.value.filter(j => ['PENDING', 'SCHEDULED'].includes(j.state?.type)))

  const stats = computed(() => ({
    total: jobs.value.length,
    completed: completedJobs.value.length,
    failed: failedJobs.value.length,
    running: runningJobs.value.length,
    pending: pendingJobs.value.length,
    successRate: jobs.value.length > 0
      ? Math.round((completedJobs.value.length / jobs.value.length) * 100)
      : 0,
  }))

  async function fetchJobs(limit = 100) {
    loading.value = true
    error.value = null
    try {
      const res = await api.getJobs(limit)
      jobs.value = res.data
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  async function fetchDeployments() {
    try {
      const res = await api.getDeployments()
      deployments.value = res.data
    } catch (e) {
      error.value = e.message
    }
  }

  async function triggerJob(deploymentName, parameters) {
    try {
      const res = await api.triggerJob(deploymentName, parameters)
      await fetchJobs()
      return res.data
    } catch (e) {
      error.value = e.message
      throw e
    }
  }

  return {
    jobs, deployments, loading, error,
    completedJobs, failedJobs, runningJobs, pendingJobs, stats,
    fetchJobs, fetchDeployments, triggerJob,
  }
})
