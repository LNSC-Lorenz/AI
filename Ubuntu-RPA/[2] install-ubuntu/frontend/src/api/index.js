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

  // Health
  getHealth() {
    return api.get('/health')
  },
}
