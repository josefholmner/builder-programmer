# Machine Works / Maskinverkstan

A side-view machine-building game with WebGPU rendering and Rapier 2D physics running in WebAssembly. The game uses Canvas 2D if WebGPU is unavailable. Swedish is the default interface language. Use **Inställningar → Språk → English** to switch.

## Play the prebuilt Windows version

In a Git checkout, install [Git LFS](https://git-lfs.com/) and fetch the prebuilt files:

```sh
git lfs install
git lfs pull
```

Double-click **Play Maskinverkstan.cmd** in the repository, or **Maskinverkstan.exe** inside **dist**. The launcher opens http://127.0.0.1:5173/ in your default browser. If port 5173 is occupied, it uses port 5174, which has a separate set of browser saves. Keep the console window open while you play and close it to stop the server.

You can also copy the complete `dist/` folder to another Windows 10 or 11 PC and double-click the executable there. Keep the executable, `index.html`, and `assets/` together. The prebuilt edition uses the .NET Framework that ships with Windows and needs no Node.js, npm, or build step.

## Build from source

Install Node.js 22.12 or newer with npm, then run these commands from the repository root:

```sh
npm ci
npm test
npm run dev
```

Vite prints the development URL. Use the same browser and URL as the launcher to access your saved machines and level progress. Stop the development server before starting the Windows launcher if it is using port 5173.

To rebuild the browser files and the double-click launcher together on Windows:

```sh
npm run build:windows
```

The command uses the Windows .NET Framework C# compiler and recreates `dist/`, including `dist/Maskinverkstan.exe`. Include the rebuilt `dist/` files when committing a playable update. Git LFS stores the launcher binary and the generated Rapier bundle.

For a browser-only build on any supported platform, use `npm run build`. This replaces `dist/` with browser assets. Use `npm run preview` for a local browser-only preview. Run `npm run build:windows` on Windows to restore the executable.

## Build and drive

1. In **Garage**, choose a part and click inside the 9.6 × 5.25 m build area. Place a structural part first. Select an existing part before placing a new one to attach them. Drag parts to reposition them. Drive wheels, motor hinges, pistons, and their moving connections are turquoise. If a saved machine is too large for the garage, move parts individually or use **Move parts inside**.
2. In **Program**, add nodes and connect an output to an input. **On start** runs when a course begins. **Wait** holds the next command for the specified number of seconds. **Set speed** and **Set position** keep their targets until another command changes them.
3. Choose **Test drive** for the flat course, or pick a course under **Levels**. A finish counts once every part has crossed the line. Completed courses can be replayed, and each completion unlocks the next course. After the flat course, build a mechanism to climb a vertical step and cross a pit.
4. Use **Save machine** to name a machine, including its program. Saving under the same name updates that entry. The **Machine library** opens previously saved machines. The library, draft, settings, and level records are stored in the current browser profile.

Speed nodes use unitless values. Zero stops the actuator, and a negative value reverses it. Wheel and hinge position is in degrees, with positive values turning clockwise. Piston position is in meters along the attachment axis. A piston can retract 0.45 m or extend 1.5 m from its build position. Attaching parts to a motor hinge or piston makes those parts move with the joint.
