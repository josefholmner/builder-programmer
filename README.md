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

## Share and test machines

Use **Export machine** in the garage to download the current machine, including unsaved edits. To export a saved version, use **Machine library → Export machine** next to its name. The `.machine.json` file contains the parts, attachments, actuator settings, and complete node program. Share that file and mention the level and when the issue occurs.

To play a shared machine, open **Machine library → Import machine**, select the file, and choose **Load** next to the imported entry. Importing a machine with an existing name creates a separately named copy. Then choose **Test drive** or a course under **Levels**.

To run the same physics without opening a browser, install the project dependencies and run:

```sh
npm run simulate -- "C:/path/to/Bana2.machine.json" step 10
```

The optional arguments select the level and the number of seconds to simulate. The defaults are `flat` and 90 seconds. Level IDs are `flat`, `step`, `pit`, `ridgeRun`, `terraces`, and `canal`. The command reports the result, elapsed time, and final part positions and angles. It can run any level regardless of browser progress.

## Build and drive

1. In **Garage**, choose a part and click inside the 9.6 × 5.25 m build area. Place a structural part first. Select an existing part before placing a new one to attach them. Press **Space** or **1** to rotate a selected primitive or its placement preview in 90° steps. Drag parts to reposition them, or select a part and press **Delete** to remove it. Drive wheels and piston connectors are yellow. The round motor hinge is orange and the servo has a turquoise square hub. The pink sticky blob is a passive, round foot with high dry friction along a surface. You can lift it off the ground with a piston or hinge. Rigid connections, including the motor hinge mount, are gray. If a saved machine is too large for the garage, move parts individually or use **Move parts inside**.
2. In **Program**, right-drag to pan and use the mouse wheel to zoom around the pointer. Drag from an output port to an input port to connect nodes. Alt-click a wire, or select it and press **Delete**, to remove it. Ctrl-click to select multiple nodes. Press **Ctrl+C** and **Ctrl+V** to copy and paste the selection with the wires between those nodes. **On start** runs when a course begins. **Wait** holds the next command for the specified number of seconds. **Set speed** and **Set position** keep their targets until another command changes them.
3. Choose **Test drive** for the flat course, or pick a course under **Levels**. A finish counts once every part has crossed the line. Completed courses can be replayed, and each completion unlocks the next course. Each course card shows the fastest completed run in the current browser profile. Routes include a vertical step, a deep pit, a ridge with ledges, terraces with a low overhead passage, and a canal with two deep trenches.
4. Use **Save machine** to name a machine, including its program. Saving under the same name updates that entry. The **Machine library** opens previously saved machines. The library, draft, settings, and level records are stored in the current browser profile.

**For** runs its **Each iteration** branch for the configured number of cycles. **While** runs that branch while the elapsed course time is below its threshold. When the branch reaches its end, control returns to the loop. Connect the **Completed** output to continue after the loop. A While body with no wait runs at most once per physics step.

Speed nodes use unitless values. Zero stops the actuator, and a negative value reverses it. Wheel and hinge position is in degrees, with positive values turning clockwise. Piston position is in meters along the attachment axis. The piston aligns with its attachment rod and extends up to 1.5 m. Existing machines can still use the long-stroke ram, which extends up to 2.7 m. The servo rotates up to 60° each way. The **All drive wheels** target runs the machine’s powered wheels. Select an actuator in the garage to set its maximum force in newtons (piston) or torque in newton-metres (wheel or motor hinge). A limit of zero disables motor output. The setting applies to both speed and position commands.

A motor hinge has a rigid mount and holds its build angle until commanded. A speed of zero holds the hinge at its current angle. Attach parts to the hinge and target it with a speed or position node to turn them around the center of the hinge.
