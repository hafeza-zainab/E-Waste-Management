$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    if ($env:RELOOP_SPEECH_LIST -eq '1') {
        $speaker.GetInstalledVoices() | ForEach-Object {
            '{0} | {1} | Enabled={2}' -f $_.VoiceInfo.Name, $_.VoiceInfo.Culture, $_.Enabled
        }
    } else {
        if ($env:TTS_VOICE) { $speaker.SelectVoice($env:TTS_VOICE) }
        $speaker.Rate = [int]$env:RELOOP_SPEECH_RATE
        $speaker.SetOutputToWaveFile($env:RELOOP_SPEECH_OUTPUT)
        $speaker.Speak([System.IO.File]::ReadAllText($env:RELOOP_SPEECH_INPUT, [System.Text.Encoding]::UTF8))
    }
} finally {
    $speaker.Dispose()
}
