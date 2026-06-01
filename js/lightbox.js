const dialog = document.getElementById("screenshot-lightbox");
const lightboxImage = dialog.querySelector(".lightbox-image");
const closeButton = dialog.querySelector(".lightbox-close");

document.querySelectorAll(".screenshot-open").forEach((button) => {
  button.addEventListener("click", () => {
    const image = button.querySelector("img");
    lightboxImage.src = image.currentSrc || image.src;
    lightboxImage.alt = image.alt;
    dialog.showModal();
  });
});

closeButton.addEventListener("click", () => {
  dialog.close();
});

dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    dialog.close();
  }
});

dialog.addEventListener("close", () => {
  lightboxImage.removeAttribute("src");
  lightboxImage.alt = "";
});
