import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
})

export default {
  // Jobs (Flow Runs)
  getJobs(limit = 50) {
    return api.get('/jobs', { params: { limit } })
  },
  getJob(id) {
    return api.get(`/jobs/${id}`)
  },
  triggerJob(deploymentName, parameters = null) {
    return api.post('/jobs/trigger', {
      deployment_name: deploymentName,
      parameters,
    })
  },

  // Deployments
  getDeployments() {
    return api.get('/deployments')
  },

  // Work Pools
  getWorkPools() {
    return api.get('/work-pools')
  },

  // Job 包上传与分发
  uploadPackage(file, jobName) {
    const form = new FormData()
    form.append('file', file)
    form.append('job_name', jobName)
    return api.post('/packages/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 300000,
    })
  },
  dispatchPackage(payload) {
    return api.post('/packages/dispatch', payload, { timeout: 60000 })
  },

  // Health
  getHealth() {
    return api.get('/health')
  },
}
