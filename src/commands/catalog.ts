/**
 * Catalog commands — manage Zalo Shop catalogs and products.
 */

import type { Command } from "commander";
import type { CreateProductCatalogPayload, UpdateProductCatalogPayload } from "zca-js";
import { resolve } from "path";
import { getApi } from "../core/zalo-client.ts";
import { success, error, info, output } from "../utils/output.ts";
import { errorMessage } from "../utils/error-message.ts";

export function registerCatalogCommands(program: Command): void {
    const catalog = program.command("catalog").description("Manage Zalo Shop catalogs and products");

    catalog
        .command("list")
        .description("List all catalogs")
        .option("-l, --limit <n>", "Items per page", parseInt, 20)
        .option("-p, --page <n>", "Page number", parseInt, 0)
        .action(async (opts: { limit: number; page: number }) => {
            try {
                const result = await getApi().getCatalogList({ limit: opts.limit, page: opts.page });
                output(result, program.opts().json);
            } catch (e) {
                error(`Get catalogs failed: ${errorMessage(e)}`);
            }
        });

    catalog
        .command("create <name>")
        .description("Create a new catalog")
        .action(async (name: string) => {
            try {
                const result = await getApi().createCatalog(name);
                output(result, program.opts().json, () => success(`Catalog "${name}" created`));
            } catch (e) {
                error(`Create catalog failed: ${errorMessage(e)}`);
            }
        });

    catalog
        .command("rename <catalogId> <name>")
        .description("Rename a catalog")
        .action(async (catalogId: string, name: string) => {
            try {
                const result = await getApi().updateCatalog({ catalogId, catalogName: name });
                output(result, program.opts().json, () => success(`Catalog renamed to "${name}"`));
            } catch (e) {
                error(`Rename catalog failed: ${errorMessage(e)}`);
            }
        });

    catalog
        .command("delete <catalogId>")
        .description("Delete a catalog")
        .action(async (catalogId: string) => {
            try {
                const result = await getApi().deleteCatalog(catalogId);
                output(result, program.opts().json, () => success(`Catalog ${catalogId} deleted`));
            } catch (e) {
                error(`Delete catalog failed: ${errorMessage(e)}`);
            }
        });

    catalog
        .command("products <catalogId>")
        .description("List products in a catalog")
        .option("-l, --limit <n>", "Items per page", parseInt, 100)
        .option("-p, --page <n>", "Page number", parseInt, 0)
        .action(async (catalogId: string, opts: { limit: number; page: number }) => {
            try {
                const result = await getApi().getProductCatalogList({
                    catalogId,
                    limit: opts.limit,
                    page: opts.page,
                });
                output(result, program.opts().json);
            } catch (e) {
                error(`Get products failed: ${errorMessage(e)}`);
            }
        });

    catalog
        .command("add-product <catalogId> <name> <price> <description>")
        .description("Add a product to a catalog")
        .option("--photos <urls...>", "Product photo URLs (up to 5)")
        .action(
            async (
                catalogId: string,
                name: string,
                price: string,
                description: string,
                opts: { photos?: string[] },
            ) => {
                try {
                    const payload: CreateProductCatalogPayload = { catalogId, productName: name, price, description };
                    if (opts.photos) payload.product_photos = opts.photos;
                    const result = await getApi().createProductCatalog(payload);
                    output(result, program.opts().json, () => success(`Product "${name}" added to catalog`));
                } catch (e) {
                    error(`Add product failed: ${errorMessage(e)}`);
                }
            },
        );

    catalog
        .command("update-product <catalogId> <productId> <name> <price> <description>")
        .description("Update a product in a catalog")
        .option("--photos <urls...>", "Product photo URLs (up to 5)")
        .action(
            async (
                catalogId: string,
                productId: string,
                name: string,
                price: string,
                description: string,
                opts: { photos?: string[] },
            ) => {
                try {
                    const payload: UpdateProductCatalogPayload = {
                        catalogId,
                        productId,
                        productName: name,
                        price,
                        description,
                        createTime: Date.now(),
                    };
                    if (opts.photos) payload.product_photos = opts.photos;
                    const result = await getApi().updateProductCatalog(payload);
                    output(result, program.opts().json, () => success(`Product ${productId} updated`));
                } catch (e) {
                    error(`Update product failed: ${errorMessage(e)}`);
                }
            },
        );

    catalog
        .command("delete-product <catalogId> <productIds...>")
        .description("Delete product(s) from a catalog")
        .action(async (catalogId: string, productIds: string[]) => {
            try {
                const result = await getApi().deleteProductCatalog({ catalogId, productIds });
                output(result, program.opts().json, () => success(`Deleted ${productIds.length} product(s)`));
            } catch (e) {
                error(`Delete product failed: ${errorMessage(e)}`);
            }
        });

    catalog
        .command("upload-photo <filePath>")
        .description("Upload a product photo (returns URL for use with add-product --photos)")
        .action(async (filePath: string) => {
            try {
                const absPath = resolve(filePath);
                const result = await getApi().uploadProductPhoto({ file: absPath });
                output(result, program.opts().json, () => {
                    info("Photo uploaded. Use the URL with: catalog add-product --photos <url>");
                });
            } catch (e) {
                error(`Upload photo failed: ${errorMessage(e)}`);
            }
        });
}
