#!/usr/bin/env node
/**
 * transcribe/scripts/run.js
 * 音声ファイルを文字起こしして結果を stdout に出力する。
 *
 * 使い方:
 *   node run.js <音声ファイルパス>
 *
 * 処理:
 *   1. 同名 .txt が存在すればその内容を返す（最優先）
 *   2. なければ whisper-cli で文字起こし
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execFileSync, spawnSync } = require('child_process');

// ─── 設定 ───────────────────────────────────────────────
const WHISPER_HOME  = path.join('C:\\Users\\ami\\Downloads\\Claude用\\.whisper');
const WHISPER_CLI   = path.join(WHISPER_HOME, 'bin', 'whisper-cli.exe');
const MODEL_PATH    = path.join(WHISPER_HOME, 'models', 'ggml-base.bin');
const FFMPEG_PATH   = path.join(
  os.tmpdir(), 'ffmpeg', 'ffmpeg-master-latest-win64-gpl', 'bin', 'ffmpeg.exe'
);
// ────────────────────────────────────────────────────────

function findFfmpeg() {
  if (fs.existsSync(FFMPEG_PATH)) return FFMPEG_PATH;
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {
    return null;
  }
}

function convertToWav(inputPath, ffmpeg) {
  const wavPath = path.join(os.tmpdir(), `transcribe_${Date.now()}.wav`);
  const result = spawnSync(ffmpeg, [
    '-i', inputPath,
    '-ar', '16000',
    '-ac', '1',
    '-f', 'wav',
    wavPath, '-y'
  ], { stdio: 'pipe' });
  if (result.status !== 0) {
    throw new Error('ffmpeg 変換失敗: ' + result.stderr.toString());
  }
  return wavPath;
}

function runWhisper(wavPath) {
  if (!fs.existsSync(WHISPER_CLI)) throw new Error(`whisper-cli が見つかりません: ${WHISPER_CLI}`);
  if (!fs.existsSync(MODEL_PATH))  throw new Error(`モデルが見つかりません: ${MODEL_PATH}`);

  const binDir = path.dirname(WHISPER_CLI);
  // model パスを bin からの相対パスで渡す（DLL と同じ cwd で実行するため）
  const modelRel = path.relative(binDir, MODEL_PATH);

  const result = spawnSync(WHISPER_CLI, [
    '-m', modelRel,
    '-l', 'ja',
    '-otxt',
    '-f', wavPath
  ], {
    stdio: 'pipe',
    cwd: binDir,           // DLL を見つけるために bin ディレクトリを cwd に
  });

  // whisper は wavPath + '.txt' に出力する
  const txtPath = wavPath + '.txt';
  if (fs.existsSync(txtPath)) {
    const text = fs.readFileSync(txtPath, 'utf8').trim();
    fs.unlinkSync(txtPath);
    return text;
  }

  if (result.status !== 0) {
    throw new Error(`whisper-cli 終了コード ${result.status}: ${result.stderr.toString().slice(-200)}`);
  }
  throw new Error('whisper から出力が得られませんでした');
}

function main() {
  const audioPath = process.argv[2];
  if (!audioPath) {
    console.error('使い方: node run.js <音声ファイルパス>');
    process.exit(1);
  }

  if (!fs.existsSync(audioPath)) {
    console.error(`ファイルが見つかりません: ${audioPath}`);
    process.exit(1);
  }

  // ① 同名 .txt を最優先で使用
  const txtSiblings = [
    path.join(path.dirname(audioPath), path.basename(audioPath, path.extname(audioPath)) + '.txt'),
    path.join(path.dirname(audioPath), 'processed', path.basename(audioPath, path.extname(audioPath)) + '.txt'),
  ];

  for (const txtPath of txtSiblings) {
    if (fs.existsSync(txtPath)) {
      process.stdout.write(fs.readFileSync(txtPath, 'utf8').trim());
      return;
    }
  }

  // ② whisper で新規文字起こし
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    console.error('ffmpeg が見つかりません。ffmpeg をインストールするか PATH に追加してください。');
    process.exit(1);
  }

  let wavPath;
  try {
    wavPath = convertToWav(audioPath, ffmpeg);
    const text = runWhisper(wavPath);
    process.stdout.write(text);
  } finally {
    if (wavPath && fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
  }
}

main();
