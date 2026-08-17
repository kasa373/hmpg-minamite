(function () {
  const codes = [51, 51, 55, 55, 51, 51];
  const storageKey = "minamite-try-ok";
  const gate = document.getElementById("gate");
  const downloads = document.getElementById("downloads");
  const form = document.getElementById("gate-form");
  const input = document.getElementById("gate-password");
  const error = document.getElementById("gate-error");

  function matches(value) {
    if (value.length !== codes.length) {
      return false;
    }
    return Array.from(value).every(function (char, index) {
      return char.charCodeAt(0) === codes[index];
    });
  }

  function unlock() {
    sessionStorage.setItem(storageKey, "1");
    gate.hidden = true;
    downloads.hidden = false;
  }

  if (sessionStorage.getItem(storageKey) === "1") {
    unlock();
    return;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (matches(input.value.trim())) {
      error.hidden = true;
      unlock();
      return;
    }
    error.hidden = false;
    input.value = "";
    input.focus();
  });
})();
