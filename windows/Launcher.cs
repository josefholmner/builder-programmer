using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

internal static class Launcher
{
    private const int DefaultPort = 5173;
    private const int FallbackPort = 5174;
    private const int HeaderLimit = 8192;
    private static readonly Dictionary<string, string> Files = new Dictionary<string, string>(StringComparer.Ordinal);
    private static readonly Dictionary<string, string> ContentTypes =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { ".html", "text/html; charset=utf-8" },
            { ".css", "text/css; charset=utf-8" },
            { ".js", "text/javascript; charset=utf-8" },
            { ".wasm", "application/wasm" },
            { ".svg", "image/svg+xml" },
            { ".png", "image/png" },
            { ".jpg", "image/jpeg" },
            { ".webp", "image/webp" },
            { ".woff2", "font/woff2" }
        };

    private static int Main(string[] args)
    {
        TcpListener listener = null;
        bool openBrowser = Array.IndexOf(args, "--no-browser") < 0;
        try
        {
            RegisterFiles();
            try
            {
                listener = Listen(DefaultPort);
            }
            catch (SocketException error)
            {
                if (error.SocketErrorCode != SocketError.AddressAlreadyInUse &&
                    error.SocketErrorCode != SocketError.AccessDenied) throw;
                listener = Listen(FallbackPort);
                Console.WriteLine("Port 5173 is unavailable. Games saved on port 5173 show up again when it is available.");
            }
            string url = "http://" + HostFor(((IPEndPoint)listener.LocalEndpoint).Port) + "/";
            Console.WriteLine("Maskinverkstan is running at " + url);
            Console.WriteLine("Close this window to stop the game.");
            if (openBrowser)
            {
                try
                {
                    Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                }
                catch (System.ComponentModel.Win32Exception)
                {
                    Console.WriteLine("Open " + url + " in your browser.");
                }
            }

            while (true)
            {
                ThreadPool.QueueUserWorkItem(ServeClient, listener.AcceptTcpClient());
            }
        }
        catch (IOException error)
        {
            Console.Error.WriteLine(error.Message);
        }
        catch (SocketException)
        {
            Console.Error.WriteLine("Could not start the local server. Free port 5173 or 5174 and try again.");
        }
        finally
        {
            if (listener != null) listener.Stop();
        }

        if (openBrowser && !Console.IsInputRedirected)
        {
            Console.WriteLine("Press Enter to close.");
            Console.ReadLine();
        }
        return 1;
    }

    private static TcpListener Listen(int port)
    {
        var listener = new TcpListener(IPAddress.Loopback, port) { ExclusiveAddressUse = true };
        listener.Start();
        return listener;
    }

    private static string HostFor(int port)
    {
        return IPAddress.Loopback + ":" + port;
    }

    private static void RegisterFiles()
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string index = Path.Combine(root, "index.html");
        string assets = Path.Combine(root, "assets");
        if (!File.Exists(index) || !Directory.Exists(assets))
        {
            throw new IOException("Keep Maskinverkstan.exe with index.html and the assets folder from dist.");
        }

        Files.Add("/", index);
        Files.Add("/index.html", index);
        foreach (string file in Directory.EnumerateFiles(assets, "*", SearchOption.AllDirectories))
        {
            if (!ContentTypes.ContainsKey(Path.GetExtension(file))) continue;
            if (new FileInfo(file).Length < 512 &&
                File.ReadAllText(file).StartsWith("version https://git-lfs.github.com/spec/v1", StringComparison.Ordinal))
            {
                throw new IOException("A game asset is missing. Run git lfs pull from the checkout.");
            }
            string relativePath = "/" + file.Substring(root.Length).Replace('\\', '/');
            Files.Add(relativePath, file);
        }
    }

    private static void ServeClient(object state)
    {
        using (var client = (TcpClient)state)
        {
            client.ReceiveTimeout = 3000;
            client.SendTimeout = 5000;
            using (NetworkStream stream = client.GetStream())
            {
                try
                {
                    string request = ReadHeaders(stream);
                    if (request == null) return;
                    string[] headers = request.Split(new[] { "\r\n" }, StringSplitOptions.None);
                    string[] line = headers[0].Split(' ');
                    string host = HostFor(((IPEndPoint)client.Client.LocalEndPoint).Port);
                    if (line.Length != 3 || !HasLocalHost(headers, host))
                    {
                        Respond(stream, "400 Bad Request");
                        return;
                    }

                    bool head = line[0] == "HEAD";
                    if (!head && line[0] != "GET")
                    {
                        Respond(stream, "405 Method Not Allowed");
                        return;
                    }

                    string path = line[1].Split('?')[0];
                    string filename;
                    if (!Files.TryGetValue(path, out filename) || !File.Exists(filename))
                    {
                        Respond(stream, "404 Not Found");
                        return;
                    }

                    using (var file = File.OpenRead(filename))
                    {
                        Respond(stream, "200 OK", ContentTypes[Path.GetExtension(filename)], file.Length);
                        if (!head) file.CopyTo(stream);
                    }
                }
                catch (IOException)
                {
                    // The browser may cancel preconnects, navigation, or individual fetches.
                }
            }
        }
    }

    private static string ReadHeaders(Stream stream)
    {
        var data = new byte[HeaderLimit];
        for (int i = 0; i < data.Length; i++)
        {
            int next = stream.ReadByte();
            if (next < 0) return null;
            data[i] = (byte)next;
            if (i >= 3 && data[i - 3] == 13 && data[i - 2] == 10 && data[i - 1] == 13 && data[i] == 10)
            {
                return Encoding.ASCII.GetString(data, 0, i + 1);
            }
        }
        return null;
    }

    private static bool HasLocalHost(string[] headers, string host)
    {
        foreach (string header in headers)
        {
            if (header.StartsWith("Host:", StringComparison.OrdinalIgnoreCase))
            {
                return string.Equals(header.Substring(5).Trim(), host, StringComparison.OrdinalIgnoreCase);
            }
        }
        return false;
    }

    private static void Respond(Stream stream, string status, string contentType = "text/plain", long length = 0)
    {
        string headers = "HTTP/1.1 " + status + "\r\nContent-Type: " + contentType
            + "\r\nContent-Length: " + length + "\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n";
        byte[] bytes = Encoding.ASCII.GetBytes(headers);
        stream.Write(bytes, 0, bytes.Length);
    }
}
