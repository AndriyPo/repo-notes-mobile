# Repo Notes Mobile

A small Android web app for capturing notes, tasks, ideas, links, shared passages, and video timestamps in your own private GitHub repository.

## Install

Open the GitHub Pages site in Chrome on Android and choose **Install**, or **Chrome menu → Add to home screen → Install**. Open the installed app once before sharing into it.

In Settings, connect your private notes repository using a fine-grained GitHub token scoped to that repository with **Contents: Read and write** access. Keep the save folder as `inbox`.

Then use **Chrome or YouTube → Share → Repo Notes**, add your thought, and tap **Save to GitHub**.

## Data

This public repository contains only the app's static files. Captures are saved as Markdown in the private repository configured in the app. The GitHub token is entered in Settings and stored on the device; never add it to this repository. Browser storage is not encrypted. Drafts and failed uploads are kept locally until you save or retry. Clearing site data removes unsent content.

The app receives only what Android shares with it. YouTube timestamp links are preserved; you can enter a video time manually. It does not inspect playback inside other apps.

## GitHub Pages

In **Settings → Pages**, select **Deploy from a branch**, choose **main** and **/(root)**, then save. The empty `.nojekyll` file tells Pages to serve the files directly. No build step or server is needed.

For runtime changes, increment the shell cache version in `sw.js`. An existing installation adopts an update after all old Repo Notes windows close.
