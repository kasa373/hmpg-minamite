const downloadTrigger = document.getElementById("ottokabu-android-dl");
const downloadDialog = document.getElementById("ottokabu-android-dialog");
const cancelButton = downloadDialog.querySelector(".download-dialog-cancel");
const confirmButton = downloadDialog.querySelector(".download-dialog-confirm");

downloadTrigger.addEventListener("click", (event) => {
  event.preventDefault();
  downloadDialog.showModal();
});

cancelButton.addEventListener("click", () => {
  downloadDialog.close();
});

confirmButton.addEventListener("click", () => {
  const url = downloadTrigger.href;
  downloadDialog.close();
  window.location.href = url;
});

downloadDialog.addEventListener("click", (event) => {
  if (event.target === downloadDialog) {
    downloadDialog.close();
  }
});

downloadDialog.addEventListener("cancel", () => {
  downloadDialog.close();
});
