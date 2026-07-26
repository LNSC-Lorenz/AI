<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h2 class="text-lg font-semibold text-zinc-100 flex items-center gap-2">
        <UploadCloud class="w-5 h-5 text-amber-500" />
        Deploy Job Package
      </h2>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Left: form -->
      <div class="bg-zinc-900 border border-zinc-800 rounded-lg p-6 space-y-5">
        <!-- Dropzone -->
        <div
          class="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors"
          :class="dragging ? 'border-amber-500 bg-amber-500/5' : 'border-zinc-700 hover:border-zinc-500'"
          @dragover.prevent="dragging = true"
          @dragleave.prevent="dragging = false"
          @drop.prevent="onDrop"
          @click="$refs.fileInput.click()"
        >
          <input ref="fileInput" type="file" accept=".zip" class="hidden" @change="onPick" />
          <FileArchive class="w-8 h-8 mx-auto mb-3 text-zinc-600" />
          <p v-if="!zipFile" class="text-sm text-zinc-500">
            拖拽 job 包(.zip)到此处，或点击选择文件
          </p>
          <p v-else class="text-sm text-amber-500 font-mono">
            {{ zipFile.name }} ({{ (zipFile.size / 1024 / 1024).toFixed(2) }} MB)
          </p>
        </div>

        <!-- Job name -->
        <div>
          <label class="block text-xs uppercase tracking-wider text-zinc-500 mb-1.5">Job 名称（目录名）</label>
          <input
            v-model="jobName"
            placeholder="e.g. RPA01_07"
            class="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm font-mono focus:border-amber-500 focus:outline-none"
          />
          <p class="text-xs text-zinc-600 mt-1">解压到 Worker 的 flows/&lt;名称&gt;/ 目录，仅限字母数字下划线连字符</p>
        </div>

        <!-- Register entrypoint -->
        <div>
          <label class="block text-xs uppercase tracking-wider text-zinc-500 mb-1.5">注册脚本（zip 内相对路径，可选）</label>
          <input
            v-model="entrypoint"
            placeholder="e.g. 05_DataJobFile/RPACN01_07_downloadfile_flow.py"
            class="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm font-mono focus:border-amber-500 focus:outline-none"
          />
          <p class="text-xs text-zinc-600 mt-1">留空则只上传文件不注册；填写后 Worker 会执行它完成 deployment 注册</p>
        </div>

        <!-- Pool selector -->
        <div>
          <label class="block text-xs uppercase tracking-wider text-zinc-500 mb-1.5">目标 Work Pools</label>
          <div class="space-y-1.5">
            <label
              v-for="pool in pools"
              :key="pool.name"
              class="flex items-center gap-2.5 px-3 py-2 bg-zinc-950 border rounded cursor-pointer text-sm transition-colors"
              :class="selectedPools.includes(pool.name) ? 'border-amber-500/60 text-zinc-200' : 'border-zinc-800 text-zinc-500 hover:border-zinc-600'"
            >
              <input type="checkbox" :value="pool.name" v-model="selectedPools" class="accent-amber-500" />
              <Server class="w-3.5 h-3.5" />
              <span class="font-mono">{{ pool.name }}</span>
              <span class="ml-auto text-xs" :class="pool.status === 'READY' ? 'text-emerald-600' : 'text-red-500'">
                {{ pool.status || 'UNKNOWN' }}
              </span>
            </label>
            <p v-if="pools.length === 0" class="text-xs text-zinc-600">未找到 work pool（gateway 离线？）</p>
          </div>
        </div>

        <!-- Submit -->
        <button
          @click="submit"
          :disabled="!canSubmit || busy"
          class="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-semibold transition-colors"
          :class="canSubmit && !busy
            ? 'bg-amber-500 text-zinc-950 hover:bg-amber-400'
            : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'"
        >
          <Loader2 v-if="busy" class="w-4 h-4 animate-spin" />
          <Rocket v-else class="w-4 h-4" />
          {{ busy ? busyText : '上传并分发注册' }}
        </button>
      </div>

      <!-- Right: results -->
      <div class="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
        <h3 class="text-sm font-semibold text-zinc-300 mb-4">分发结果</h3>
        <div v-if="results.length === 0" class="text-sm text-zinc-600">
          尚未分发。上传后每个目标池会启动一个 deploy-job 运行，Worker 自行下载解压并注册。
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="r in results"
            :key="r.pool"
            class="flex items-center gap-3 px-3 py-2.5 bg-zinc-950 border rounded text-sm font-mono"
            :class="r.error ? 'border-red-900' : 'border-emerald-900'"
          >
            <XCircle v-if="r.error" class="w-4 h-4 text-red-500 shrink-0" />
            <CheckCircle2 v-else class="w-4 h-4 text-emerald-500 shrink-0" />
            <span class="text-zinc-300">{{ r.pool }}</span>
            <span v-if="r.error" class="text-red-400 text-xs ml-auto">{{ r.error }}</span>
            <router-link
              v-else
              :to="`/jobs/${r.flow_run_id}`"
              class="text-amber-500 hover:underline text-xs ml-auto"
            >run {{ r.flow_run_id.slice(0, 8) }} →</router-link>
          </div>
        </div>
        <div v-if="uploadedUrl" class="mt-4 pt-4 border-t border-zinc-800 text-xs font-mono text-zinc-600 break-all">
          包地址: {{ uploadedUrl }}
        </div>
      </div>
    </div>

    <!-- Toast -->
    <transition name="fade">
      <div
        v-if="toast.show"
        class="fixed bottom-6 right-6 px-4 py-3 rounded shadow-lg text-sm font-medium"
        :class="toast.type === 'success' ? 'bg-emerald-900 text-emerald-200' : 'bg-red-900 text-red-200'"
      >{{ toast.message }}</div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, reactive, onMounted } from 'vue'
import { UploadCloud, FileArchive, Server, Rocket, Loader2, CheckCircle2, XCircle } from 'lucide-vue-next'
import api from '../api'

const zipFile = ref(null)
const jobName = ref('')
const entrypoint = ref('')
const pools = ref([])
const selectedPools = ref([])
const busy = ref(false)
const busyText = ref('')
const results = ref([])
const uploadedUrl = ref('')
const dragging = ref(false)
const toast = reactive({ show: false, message: '', type: 'success' })

const canSubmit = computed(() =>
  zipFile.value && /^[A-Za-z0-9_\-]+$/.test(jobName.value) && selectedPools.value.length > 0
)

function showToast(message, type = 'success') {
  toast.show = true
  toast.message = message
  toast.type = type
  setTimeout(() => { toast.show = false }, 4000)
}

function onPick(e) {
  const f = e.target.files[0]
  if (f) setFile(f)
}

function onDrop(e) {
  dragging.value = false
  const f = e.dataTransfer.files[0]
  if (f) setFile(f)
}

function setFile(f) {
  if (!f.name.toLowerCase().endsWith('.zip')) {
    showToast('只接受 .zip 文件', 'error')
    return
  }
  zipFile.value = f
  if (!jobName.value) {
    jobName.value = f.name.replace(/\.zip$/i, '').replace(/[^A-Za-z0-9_\-]/g, '_')
  }
}

async function submit() {
  busy.value = true
  results.value = []
  try {
    busyText.value = '上传中...'
    const up = await api.uploadPackage(zipFile.value, jobName.value)
    uploadedUrl.value = up.data.url

    busyText.value = '分发中...'
    const res = await api.dispatchPackage({
      package_file: up.data.package_file,
      job_name: jobName.value,
      work_pools: selectedPools.value,
      register_entrypoint: entrypoint.value.trim(),
    })
    results.value = res.data.dispatched
    const failed = results.value.filter(r => r.error).length
    showToast(failed === 0 ? `已分发到 ${results.value.length} 个池` : `${failed} 个池分发失败`, failed === 0 ? 'success' : 'error')
  } catch (e) {
    showToast(`失败: ${e.response?.data?.detail || e.message}`, 'error')
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  try {
    const res = await api.getWorkPools()
    pools.value = res.data
  } catch { /* gateway offline */ }
})
</script>
