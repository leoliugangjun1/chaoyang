const statusElement = document.querySelector("#service-status");
const emptyStateElement = document.querySelector("#empty-state");
const errorStateElement = document.querySelector("#error-state");
const errorMessageElement = document.querySelector("#error-message");
const retryButton = document.querySelector("#retry-button");

function showLoading() {
  statusElement.hidden = false;
  statusElement.textContent = "正在连接本地服务";
  statusElement.className = "status status-loading";
  emptyStateElement.hidden = true;
  errorStateElement.hidden = true;
}

async function loadBootstrap() {
  showLoading();
  const endpoint = new URLSearchParams(window.location.search).has("simulateApiError")
    ? "/api/unavailable"
    : "/api/bootstrap";

  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(`请求失败（${response.status}）`);
    }

    const payload = await response.json();
    statusElement.hidden = true;
    emptyStateElement.hidden = payload.projects.length !== 0;
  } catch (error) {
    statusElement.hidden = true;
    errorMessageElement.textContent = error instanceof Error ? error.message : "请求失败";
    errorStateElement.hidden = false;
  }
}

retryButton.addEventListener("click", loadBootstrap);
loadBootstrap();

