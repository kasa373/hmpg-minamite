(function () {
  const codes = [51, 55, 51];
  const storageKey = "minamite-work-ok";
  const skipNames = { ".gitkeep": true };
  const gate = document.getElementById("gate");
  const downloads = document.getElementById("downloads");
  const form = document.getElementById("gate-form");
  const input = document.getElementById("gate-password");
  const error = document.getElementById("gate-error");
  const status = document.getElementById("file-status");
  const list = document.getElementById("file-list");

  function matches(value) {
    if (value.length !== codes.length) {
      return false;
    }
    return Array.from(value).every(function (char, index) {
      return char.charCodeAt(0) === codes[index];
    });
  }

  function formatSize(bytes) {
    if (typeof bytes !== "number" || bytes < 0) {
      return "";
    }
    if (bytes < 1024) {
      return bytes + " B";
    }
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + " KB";
    }
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function contentsUrl() {
    const host = location.hostname;
    if (host.endsWith(".github.io")) {
      const owner = host.slice(0, -".github.io".length);
      const repo = location.pathname.split("/").filter(Boolean)[0];
      if (owner && repo) {
        return "https://api.github.com/repos/" + owner + "/" + repo + "/contents/work/files";
      }
    }
    return "https://api.github.com/repos/kasa373/hmpg-minamite/contents/work/files";
  }

  function renderFiles(entries) {
    const files = entries
      .filter(function (entry) {
        return entry.type === "file" && !skipNames[entry.name] && entry.name.charAt(0) !== ".";
      })
      .sort(function (a, b) {
        return a.name.localeCompare(b.name, "ja");
      });

    list.replaceChildren();

    if (files.length === 0) {
      status.hidden = false;
      list.hidden = true;
      status.textContent = "いま渡せるファイルはありません。";
      return;
    }

    files.forEach(function (file) {
      const row = document.createElement("div");
      row.className = "file-row";

      const name = document.createElement("span");
      name.className = "file-name";
      name.textContent = file.name;

      const size = document.createElement("span");
      size.className = "file-size";
      size.textContent = formatSize(file.size);

      const link = document.createElement("a");
      link.className = "product-link";
      link.href = "files/" + encodeURIComponent(file.name);
      link.download = file.name;
      link.textContent = "ダウンロード";

      row.append(name, size, link);
      list.append(row);
    });

    status.hidden = true;
    list.hidden = false;
  }

  function loadFiles() {
    status.hidden = false;
    list.hidden = true;
    status.textContent = "読み込み中…";

    fetch(contentsUrl())
      .then(function (response) {
        if (response.status === 404) {
          return [];
        }
        if (!response.ok) {
          throw new Error("list-failed");
        }
        return response.json();
      })
      .then(function (data) {
        renderFiles(Array.isArray(data) ? data : []);
      })
      .catch(function () {
        status.hidden = false;
        list.hidden = true;
        status.textContent = "一覧を取得できませんでした。GitHub に上げたあと、時間をおいて開き直してください。";
      });
  }

  function unlock() {
    sessionStorage.setItem(storageKey, "1");
    gate.hidden = true;
    downloads.hidden = false;
    loadFiles();
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
