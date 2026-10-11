<template>
  <el-dialog
    :title="t('about.title')"
    v-model="dialogVisible"
    width="400px"
    class="about-dialog"
    :close-on-click-modal="true"
  >
    <div class="about-content">
      <div class="about-logo">
        <img src="../assets/icon.png" alt="SuperConnectX" />
      </div>
      <h2 class="about-title">SuperConnectX</h2>
      <p class="about-version">{{ t('about.version', { version }) }}</p>
      <p class="about-desc">{{ t('about.description') }}</p>
      <div class="about-divider"></div>
      <div class="about-contributors">
        <p class="about-contributors-title">{{ t('about.contributors') }}</p>
        <div class="contributor-list">
          <a
            v-for="contributor in contributors"
            :key="contributor.github"
            class="contributor-item"
            href="#"
            :title="contributor.github"
            @click.prevent="openContributor(contributor.github)"
          >
            <img class="contributor-avatar" :src="contributor.avatar" :alt="contributor.name" />
            <span class="contributor-name">{{ contributor.name }}</span>
          </a>
        </div>
      </div>
      <div class="about-divider"></div>
      <p class="about-links">
        <a href="#" @click.prevent="openGithub">GitHub</a> |
        <a href="#" @click.prevent="openDoc">{{ t('about.doc') }}</a>
      </p>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import rawContributors from '../assets/about/contributors.json'

const { t } = useI18n()

const dialogVisible = defineModel<boolean>()

const version = ref('')

const loadVersion = async () => {
  try {
    version.value = await window.windowApi.getAppVersion()
  } catch (error) {
    version.value = '1.0.0'
  }
}

loadVersion()

const openGithub = () => {
  window.toolApi.openExternalUrl('https://github.com/SuperStudio/SuperConnectX')
}

const openDoc = () => {
  window.toolApi.openExternalUrl('https://github.com/SuperStudio/SuperConnectX#readme')
}

const openContributor = (github: string) => {
  window.toolApi.openExternalUrl(github)
}

// 构建时收集 about 目录下的本地头像，按贡献者 name 拼接查找（支持 .png/.jpg）
const avatarModules = import.meta.glob('../assets/about/*.{png,jpg}', { eager: true, import: 'default' }) as Record<string, string>
const resolveLocalAvatar = (name: string): string => {
  const found = Object.entries(avatarModules).find(([path]) => {
    const base = path.split('/').pop()?.split('.')[0]
    return base === name
  })
  return found ? found[1] : ''
}

const contributors = (rawContributors as Array<{ name: string; github: string; avatar: string; role: string }>).map(
  (c) => ({ ...c, avatar: resolveLocalAvatar(c.name) })
)
</script>

<style scoped>
.about-dialog :deep(.el-dialog__body) {
  text-align: center;
  padding: 20px;
}

.about-content {
  text-align: center;
}

.about-logo {
  width: 80px;
  height: 80px;
  margin: 0 auto 16px;
}

.about-logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.about-title {
  color: var(--about-title-color);
  font-size: 20px;
  margin: 0 0 8px 0;
}

.about-version {
  color: var(--about-version-color);
  font-size: 14px;
  margin: 0 0 8px 0;
}

.about-desc {
  color: var(--about-desc-color);
  font-size: 13px;
  margin: 0 0 16px 0;
}

.about-divider {
  height: 1px;
  background: var(--about-divider-bg);
  margin: 16px 0;
}

.about-author,
.about-copyright {
  color: var(--about-desc-color);
  font-size: 12px;
  margin: 4px 0;
}

.about-links {
  color: var(--about-link-color);
  font-size: 13px;
  margin: 8px 0 0 0;
}

.about-links a {
  color: var(--about-link-color);
  text-decoration: none;
  margin: 0 8px;
}

.about-links a:hover {
  text-decoration: underline;
}

.about-contributors-title {
  color: var(--about-desc-color);
  font-size: 13px;
  margin: 0 0 12px 0;
}

.contributor-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 16px;
}

.contributor-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 72px;
  text-decoration: none;
  color: var(--about-desc-color);
  transition: transform 0.2s ease;
}

.contributor-item:hover {
  transform: translateY(-4px);
}

.contributor-avatar {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid transparent;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.contributor-item:hover .contributor-avatar {
  border-color: var(--about-link-color);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
}

.contributor-name {
  margin-top: 8px;
  font-size: 12px;
  transition: color 0.2s ease;
}

.contributor-item:hover .contributor-name {
  color: var(--about-link-color);
}
</style>
